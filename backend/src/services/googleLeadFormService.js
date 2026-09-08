const crypto = require("crypto");
const integrationConnectionModel = require("../models/integrationConnectionModel");
const integrationConnectionService = require("./integrationConnectionService");
const ingestionService = require("./ingestionService");
const { decrypt } = require("../utils/encryption");
const config = require("../config");
const logger = require("../utils/logger");

const PROVIDER = "google";
// The lead_sources row ingestionService.resolveSourceId lazily creates
// when a webhook event carries no explicit sourceId — without this, it
// would fall back to the bare provider slug ("google") as both the
// source's name and type; this gives it the same friendly-name-vs-stable-
// type split leadSourceModel's own findOrCreateMetaSource ("Meta Ads" /
// "meta") already established.
const SOURCE_DISPLAY_NAME = "Google Ads";

/**
 * Google Ads Lead Form webhooks (https://developers.google.com/google-ads/
 * webhook/docs/implementation) need NO OAuth at all — an advertiser
 * configures a webhook URL + a shared-secret "key" directly on each lead
 * form asset in the Google Ads UI, and Google POSTs the FULL lead payload
 * (no separate "fetch the real data" API call, unlike Meta's Graph API
 * step) to that URL on every submission, echoing the key back in the body
 * for verification. There is also no Google-issued account/customer id
 * anywhere in that payload — WE mint the identifier the webhook URL
 * resolves through, same integration_connections table, just a different
 * source for external_account_id than Meta's page_id (which Meta itself
 * assigns and sends).
 */

function generateToken() {
  // 32 hex chars, matching web_forms.form_key's own convention for an
  // opaque, unguessable, URL-safe identifier.
  return crypto.randomBytes(16).toString("hex");
}

function generateWebhookKey() {
  return crypto.randomBytes(24).toString("base64url");
}

function webhookUrlFor(token) {
  return `${config.appUrl}/api/integrations/${PROVIDER}/webhook/${token}`;
}

/**
 * Creates (or replaces) this Client's Google Ads connection — token +
 * key are both generated HERE, never supplied by the caller (there is
 * nothing for a Client Admin to already know). The plaintext key is
 * returned exactly once, for the Admin to paste into Google Ads; it is
 * never re-derivable afterward (getConnection below never decrypts it
 * back out), matching every other credential in this schema.
 */
async function connect(clientId) {
  const token = generateToken();
  const webhookKey = generateWebhookKey();
  await integrationConnectionService.updateConnection(clientId, PROVIDER, {
    externalAccountId: token,
    credentials: webhookKey,
    status: "connected",
  });
  return { webhookUrl: webhookUrlFor(token), webhookKey };
}

async function getConnection(clientId) {
  return integrationConnectionService.getConnection(clientId, PROVIDER);
}

async function disconnect(clientId) {
  return integrationConnectionService.disconnect(clientId, PROVIDER);
}

// "Validating google_key is the same as configured in Google Ads..." —
// Google's own docs confirm there is no signature header or HMAC for
// this provider, only this shared-secret field inside the JSON body.
// Constant-time compare since it's still a bearer secret.
function verifyGoogleKey(connection, providedKey) {
  if (!connection?.credentials_encrypted || typeof providedKey !== "string" || !providedKey) return false;
  let stored;
  try {
    stored = decrypt(connection.credentials_encrypted);
  } catch {
    return false;
  }
  const a = Buffer.from(stored);
  const b = Buffer.from(providedKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// user_column_data -> the {key, value} shape integrationFieldMappingService
// already expects (see ingestionService.resolveFields). column_id is the
// STABLE identifier (survives the advertiser editing a question's display
// text) — same reasoning Meta's own field.name (not a label) is used as
// the mapping key.
function toRawFields(userColumnData) {
  return (userColumnData || []).map((f) => ({ key: f.column_id, value: f.string_value }));
}

/**
 * The webhook entry point. Google's own contract (confirmed via their
 * developer docs) is explicit: return 200 for success, a 4XX for a
 * non-retryable problem (Google will NOT retry), a 5XX for a transient
 * one (Google WILL retry) — this maps directly onto ingestionService's
 * own permanent-vs-retryable failure classification, so the accurate
 * synchronous response IS this provider's "retry" signal, on top of (not
 * instead of) ingestionService's own internal backoff — both are safe
 * together because of the (provider, externalLeadId) idempotency
 * guarantee either path relies on.
 *
 * Unlike Meta, there is no slow external API call needed to enrich this
 * event — Google's payload already carries the full lead — so processing
 * synchronously within the request (still fast: a handful of indexed
 * queries, no network call) is both simpler and gives Google's own retry
 * contract a truthful answer, rather than always acknowledging 200 and
 * deferring everything to an internal timer the way Meta's webhook does.
 */
async function handleWebhookEvent(token, payload) {
  const connection = await integrationConnectionModel.findByProviderAndAccount(PROVIDER, token);
  if (!connection) {
    return { httpStatus: 404, body: { message: "Unknown webhook." } };
  }
  if (!verifyGoogleKey(connection, payload?.google_key)) {
    logger.warn(`Google Ads webhook: key mismatch for client_id=${connection.client_id}`);
    return { httpStatus: 403, body: { message: "Invalid key." } };
  }
  if (!payload?.lead_id || !payload?.form_id) {
    return { httpStatus: 400, body: { message: "Missing lead_id or form_id." } };
  }

  const clientId = connection.client_id;
  const externalFormId = String(payload.form_id);
  const externalLeadId = String(payload.lead_id);

  // Never persisted, even though it's already validated by this point —
  // raw_payload is an audit trail, not a place a bearer secret belongs.
  const { google_key: _googleKey, ...safePayload } = payload || {};

  if (payload.is_test === true) {
    // A connectivity check fired from the Google Ads UI, not a real
    // customer — acknowledge it so the Admin sees their setup works, but
    // never create a CRM lead (or even an integration_events row) from
    // it: a test ping has no guarantee of a meaningful/unique lead_id and
    // isn't a "delivery" the queue/idempotency model is meant to track.
    logger.info(`Google Ads webhook: test lead received for client_id=${clientId}, form_id=${externalFormId}`);
    return { httpStatus: 200, body: {} };
  }

  const normalizedLead = {
    provider: PROVIDER,
    clientId,
    externalLeadId,
    externalFormId,
    submittedAt: payload.lead_submit_time || new Date().toISOString(),
    rawFields: toRawFields(payload.user_column_data),
    sourceDisplayName: SOURCE_DISPLAY_NAME,
    attribution: {
      campaignId: payload.campaign_id ?? null,
      adGroupId: payload.adgroup_id ?? null,
      creativeId: payload.creative_id ?? null,
      assetGroupId: payload.asset_group_id ?? null,
      gclId: payload.gcl_id ?? null,
      leadSource: payload.lead_source ?? null,
      leadStage: payload.lead_stage ?? null,
    },
    eventType: "lead",
    rawPayload: safePayload,
  };

  const result = await ingestionService.ingest(normalizedLead);

  if (result.outcome === "created" || result.outcome === "duplicate" || result.outcome === "skipped") {
    return { httpStatus: 200, body: {} };
  }
  // outcome === "failed"
  return result.retryable
    ? { httpStatus: 500, body: { message: "Temporary error, please retry." } }
    : { httpStatus: 400, body: { message: result.error || "Could not process this lead." } };
}

module.exports = { connect, getConnection, disconnect, handleWebhookEvent, PROVIDER };
