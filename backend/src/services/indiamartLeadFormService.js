const crypto = require("crypto");
const integrationConnectionModel = require("../models/integrationConnectionModel");
const integrationConnectionService = require("./integrationConnectionService");
const ingestionService = require("./ingestionService");
const config = require("../config");
const logger = require("../utils/logger");

const PROVIDER = "indiamart";
const SOURCE_DISPLAY_NAME = "IndiaMART";

// IndiaMART has no per-form/per-asset concept at all (confirmed in the
// discovery audit — enquiries come from one undifferentiated inbox per
// seller account, distinguished only by QUERY_TYPE, not by any form
// identifier) — "default" is the same provider-neutral placeholder the
// schema's own migration comment describes for exactly this case.
const EXTERNAL_FORM_ID = "default";

const QUERY_TYPE_LABELS = { W: "Direct Enquiry", B: "Buy Lead", P: "Call", BIZ: "Catalog View", WA: "WhatsApp Enquiry" };

/**
 * IndiaMART's Push API (confirmed via help.indiamart.com — the discovery
 * audit's own report has the full sourcing) needs no OAuth and, unlike
 * every other provider this foundation already integrates, provides NO
 * shared secret, signature, or credential of any kind to verify a
 * delivery with — the seller registers a webhook URL directly on their
 * IndiaMART dashboard (completing an OTP sent to their own phone, a step
 * this backend cannot automate), and IndiaMART simply POSTs the complete
 * lead to that URL. The URL's own unguessable token IS the entire
 * security model — same reasoning as Google Ads' minted token, just
 * without Google's additional google_key body field on top of it.
 */

function generateToken() {
  // 32 hex chars — same convention as every other minted routing token
  // in this schema (Google's own generateToken, web_forms.form_key).
  return crypto.randomBytes(16).toString("hex");
}

function webhookUrlFor(token) {
  return `${config.appUrl}/api/integrations/${PROVIDER}/webhook/${token}`;
}

/**
 * Mints a fresh webhook URL for this Client — no key/credential to
 * generate or store (see module comment), so unlike googleLeadFormService.
 * connect, credentials_encrypted stays NULL for every IndiaMART connection.
 * The Client Admin still has real work to do after this: paste the URL
 * into IndiaMART's own Lead Manager > Push API screen and confirm the
 * OTP sent to their account's registered phone — this call only handles
 * our own side of that handshake.
 */
async function connect(clientId) {
  const token = generateToken();
  await integrationConnectionService.updateConnection(clientId, PROVIDER, {
    externalAccountId: token,
    status: "connected",
  });
  return { webhookUrl: webhookUrlFor(token) };
}

async function getConnection(clientId) {
  return integrationConnectionService.getConnection(clientId, PROVIDER);
}

async function disconnect(clientId) {
  return integrationConnectionService.disconnect(clientId, PROVIDER);
}

// The business/contextual fields eligible for admin field-mapping — same
// "every field goes through explicit mapping, nothing auto-maps" discipline
// Meta/Google/LinkedIn already established. UNIQUE_QUERY_ID/QUERY_TYPE/
// QUERY_TIME are deliberately excluded here: they're provider identifiers/
// metadata (see the discovery audit's own §6/§9 categorization), always
// preserved in attribution, never offered as a mappable "field".
const MAPPABLE_FIELD_KEYS = [
  "SENDER_NAME",
  "SENDER_MOBILE",
  "SENDER_MOBILE_ALT",
  "SENDER_EMAIL",
  "SENDER_EMAIL_ALT",
  "SENDER_PHONE",
  "SENDER_PHONE_ALT",
  "SENDER_COMPANY",
  "SENDER_ADDRESS",
  "SENDER_CITY",
  "SENDER_STATE",
  "SENDER_PINCODE",
  "SENDER_COUNTRY_ISO",
  "SUBJECT",
  "QUERY_PRODUCT_NAME",
  "QUERY_MESSAGE",
  "QUERY_MCAT_NAME",
  "CALL_DURATION",
  "RECEIVER_MOBILE",
];

// IndiaMART sends every field on every delivery, but leaves the ones that
// don't apply (e.g. CALL_DURATION on a non-call enquiry) as empty strings
// rather than omitting the key — unlike Meta, whose field_data simply
// never contains an unanswered question. Filtered out here so an admin's
// mapping list isn't cluttered with always-empty values, and so an empty
// string is never written into a custom field.
function toRawFields(response) {
  return MAPPABLE_FIELD_KEYS.filter((key) => response[key] !== undefined && response[key] !== null && response[key] !== "").map((key) => ({
    key,
    value: response[key],
  }));
}

// QUERY_TIME is documented as "YYYY-MM-DD HH:MM:SS" (confirmed via the
// audit's literal sample: "2024-04-10 11:17:14"), with no timezone marker
// of its own — the Pull API's own date-range parameters are documented as
// IST, and this is the only reasonable basis available to assume Push's
// timestamp is the same; flagged here, not silently assumed. Falls back
// to "now" for a missing/malformed value rather than failing the whole
// delivery over a timestamp.
function parseQueryTime(queryTime) {
  if (typeof queryTime !== "string" || !queryTime.trim()) return new Date().toISOString();
  const parsed = new Date(`${queryTime.trim().replace(" ", "T")}+05:30`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * The webhook entry point. IndiaMART's own documented contract: retries
 * "at regular intervals" (interval unspecified) until it gets an HTTP 200,
 * and deactivates the whole subscription after 48 continuous hours without
 * one — no documented distinction between a 4xx and 5xx response the way
 * Google Ads explicitly makes. In the absence of a documented distinction,
 * this follows the same 4xx-permanent/5xx-retryable convention every other
 * provider in this foundation already uses, as the most defensible default
 * rather than inventing IndiaMART-specific retry semantics.
 *
 * Like Google Ads and unlike Meta/LinkedIn, the pushed payload is already
 * the complete lead — no follow-up API call is needed to enrich it, so
 * processing happens synchronously within the request.
 */
async function handleWebhookEvent(token, payload) {
  const connection = await integrationConnectionModel.findByProviderAndAccount(PROVIDER, token);
  if (!connection) {
    return { httpStatus: 404, body: {} };
  }

  const response = payload?.RESPONSE;
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return { httpStatus: 400, body: { message: "Missing RESPONSE object." } };
  }
  const uniqueQueryId = response.UNIQUE_QUERY_ID;
  if (typeof uniqueQueryId !== "string" && typeof uniqueQueryId !== "number") {
    return { httpStatus: 400, body: { message: "Missing RESPONSE.UNIQUE_QUERY_ID." } };
  }

  const clientId = connection.client_id;
  // Composite idempotency key — deliberately NOT bare UNIQUE_QUERY_ID.
  // The discovery audit could not verify from any accessible IndiaMART
  // documentation whether UNIQUE_QUERY_ID is unique platform-wide or only
  // within one seller's own account; prefixing with our own
  // external_account_id (this connection's own unique token) makes the
  // (provider, external_lead_id) uniqueness guarantee safe either way —
  // see the discovery follow-up report for the full comparison. No schema
  // change: external_lead_id is a plain VARCHAR, this is just the string
  // this adapter chooses to build before calling ingest().
  const externalLeadId = `${connection.external_account_id}_${uniqueQueryId}`;

  const normalizedLead = {
    provider: PROVIDER,
    clientId,
    externalLeadId,
    externalFormId: EXTERNAL_FORM_ID,
    submittedAt: parseQueryTime(response.QUERY_TIME),
    rawFields: toRawFields(response),
    sourceDisplayName: SOURCE_DISPLAY_NAME,
    attribution: {
      uniqueQueryId: String(uniqueQueryId),
      queryType: response.QUERY_TYPE ?? null,
      queryTypeLabel: QUERY_TYPE_LABELS[response.QUERY_TYPE] ?? null,
      queryTime: response.QUERY_TIME ?? null,
    },
    eventType: "lead",
    rawPayload: payload,
  };

  const result = await ingestionService.ingest(normalizedLead);

  if (result.outcome === "created" || result.outcome === "duplicate" || result.outcome === "skipped") {
    return { httpStatus: 200, body: {} };
  }
  // outcome === "failed"
  if (!result.retryable) {
    logger.warn(`IndiaMART webhook: permanent failure for client_id=${clientId}, unique_query_id=${uniqueQueryId}: ${result.error}`);
  }
  return result.retryable
    ? { httpStatus: 500, body: { message: "Temporary error, please retry." } }
    : { httpStatus: 400, body: { message: result.error || "Could not process this lead." } };
}

module.exports = { connect, getConnection, disconnect, handleWebhookEvent, PROVIDER };
