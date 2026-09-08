const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const integrationConnectionModel = require("../models/integrationConnectionModel");
const integrationConnectionService = require("./integrationConnectionService");
const ingestionService = require("./ingestionService");
const linkedinClient = require("../integrations/linkedin/linkedinClient");
const { computeChallengeResponse, verifyLinkedInSignature } = require("../integrations/linkedin/verifySignature");
const { encrypt, decrypt } = require("../utils/encryption");
const httpError = require("../utils/httpError");
const config = require("../config");
const logger = require("../utils/logger");

const PROVIDER = "linkedin";
const SOURCE_DISPLAY_NAME = "LinkedIn Lead Gen Forms";
const STATE_EXPIRY = "10m";
const OAUTH_SCOPES = "r_marketing_leadgen_automation";
const OWNER_TYPES = new Set(["organization", "sponsoredAccount"]);
// Refresh proactively once within this window of expiry rather than
// waiting for a 401 mid-webhook — LinkedIn access tokens are documented
// as short-lived (~60 days), unlike Meta's long-lived page tokens, so an
// integration that never refreshes would silently die every two months.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function requireConfigured() {
  if (!config.linkedin.clientId || !config.linkedin.clientSecret) {
    throw httpError("LinkedIn integration is not configured on this server.", 400, "LINKEDIN_NOT_CONFIGURED");
  }
}

function generateWebhookToken() {
  return crypto.randomBytes(16).toString("hex");
}

function webhookUrlFor(token) {
  return `${config.appUrl}/api/integrations/linkedin/webhook/${token}`;
}

// Same "sign a short-lived JWT as the OAuth state param, no server-side
// session storage" pattern metaIntegrationService.issueState uses —
// carries ownerType/ownerId through LinkedIn's redirect too, since the
// callback (a public GET, no Authorization header) has nothing else to
// resolve them from. See connect() for why the Client Admin supplies
// these up front rather than picking from a discovered list.
function issueState(clientId, adminUserId, ownerType, ownerId) {
  return jwt.sign({ clientId, adminUserId, ownerType, ownerId, purpose: "linkedin_oauth" }, config.jwt.accessSecret, { expiresIn: STATE_EXPIRY });
}

function verifyState(state) {
  try {
    const payload = jwt.verify(state, config.jwt.accessSecret);
    if (payload.purpose !== "linkedin_oauth") throw new Error("wrong purpose");
    return payload;
  } catch {
    throw httpError("This connection link has expired or is invalid. Please start over from the CRM.", 400, "LINKEDIN_STATE_INVALID");
  }
}

function ownerUrnFor(ownerType, ownerId) {
  return `urn:li:${ownerType}:${ownerId}`;
}

/**
 * LinkedIn's Lead Sync API has no "list the ad accounts/organizations I
 * manage" endpoint documented alongside leadForms/leadFormResponses/
 * leadNotifications (only the Advertising API's own account-listing
 * endpoints do, which are a separate, unverified surface) — so unlike
 * Meta's beginConnect (which auto-discovers and connects the first Page),
 * this asks the Client Admin to supply the owner directly: the
 * organization or sponsoredAccount ID they already see in LinkedIn
 * Campaign Manager/Page admin settings. Documented simplification, not an
 * oversight — mirrors Google Ads' own "admin pastes values from Google's
 * own UI" precedent rather than inventing an unverified discovery call.
 */
function validateOwner(ownerType, ownerId) {
  if (!OWNER_TYPES.has(ownerType)) {
    throw httpError(`ownerType must be one of: ${[...OWNER_TYPES].join(", ")}.`, 400);
  }
  if (typeof ownerId !== "string" || !/^\d{1,32}$/.test(ownerId.trim())) {
    throw httpError("ownerId must be the numeric LinkedIn organization or ad account ID.", 400);
  }
  return ownerId.trim();
}

function beginConnect(clientId, adminUserId, ownerType, ownerId) {
  requireConfigured();
  const cleanOwnerId = validateOwner(ownerType, ownerId);
  const state = issueState(clientId, adminUserId, ownerType, cleanOwnerId);
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.linkedin.clientId);
  url.searchParams.set("redirect_uri", config.linkedin.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", OAUTH_SCOPES);
  return { authorizationUrl: url.toString() };
}

function tokenExpiryDate(expiresInSeconds) {
  return expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null;
}

/**
 * §"OAuth callback": exchanges the code, registers an owner-level
 * leadNotifications subscription against a freshly-minted per-connection
 * webhook URL (same "we mint the routing token, LinkedIn/Google never
 * issues us one" reasoning googleLeadFormService.connect already
 * documents), and persists everything. LinkedIn will call back to that
 * webhook URL with a GET ?challengeCode= shortly after this returns
 * (asynchronously, outside this request) to validate it — see
 * handleChallengeValidation.
 */
async function completeConnect(code, state) {
  const { clientId, ownerType, ownerId } = verifyState(state);
  const ownerUrn = ownerUrnFor(ownerType, ownerId);

  const tokenResponse = await linkedinClient.exchangeCodeForToken(code);
  const webhookToken = generateWebhookToken();
  const webhookUrl = webhookUrlFor(webhookToken);

  let subscriptionId = null;
  try {
    subscriptionId = await linkedinClient.createLeadNotificationSubscription(
      { webhook: webhookUrl, ownerType, ownerUrn, leadType: "SPONSORED" },
      tokenResponse.access_token
    );
  } catch (err) {
    throw httpError(err.message || "Could not register the LinkedIn lead notification subscription.", err.status || 502, "LINKEDIN_SUBSCRIPTION_FAILED");
  }

  const credentials = JSON.stringify({
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    accessTokenExpiresAt: tokenExpiryDate(tokenResponse.expires_in),
    refreshTokenExpiresAt: tokenExpiryDate(tokenResponse.refresh_token_expires_in),
  });

  try {
    const row = await integrationConnectionService.updateConnection(clientId, PROVIDER, {
      externalAccountId: webhookToken,
      status: "connected",
      credentials,
      config: { ownerType, ownerId, ownerUrn, leadType: "SPONSORED", subscriptionId, webhookValidated: false },
    });
    return row;
  } catch (err) {
    // Registered a subscription with LinkedIn but failed to persist it —
    // best-effort cleanup so we don't leak a live subscription pointing
    // at a connection our own DB never recorded.
    if (subscriptionId) {
      linkedinClient.deleteLeadNotificationSubscription(subscriptionId, tokenResponse.access_token).catch(() => {});
    }
    throw err;
  }
}

async function getConnection(clientId) {
  return integrationConnectionService.getConnection(clientId, PROVIDER);
}

async function disconnect(clientId) {
  const row = await integrationConnectionModel.findByClientAndProvider(clientId, PROVIDER);
  if (row?.config?.subscriptionId && row.credentials_encrypted) {
    try {
      const creds = JSON.parse(decrypt(row.credentials_encrypted));
      await linkedinClient.deleteLeadNotificationSubscription(row.config.subscriptionId, creds.accessToken);
    } catch (err) {
      // Best-effort — a stale/unreachable LinkedIn subscription is a
      // minor hygiene issue (LinkedIn caps at 1,500 per app), never a
      // reason to block the Client Admin from disconnecting locally.
      logger.warn(`LinkedIn disconnect: could not remove remote subscription for client_id=${clientId}: ${err.message}`);
    }
  }
  return integrationConnectionService.disconnect(clientId, PROVIDER);
}

/**
 * GET /webhook/:token — LinkedIn's challenge-response validation, sent
 * both at initial registration and on its ~2-hour recurring re-check.
 * Must respond within 3 seconds; a single indexed lookup + one HMAC
 * comfortably clears that.
 */
async function handleChallengeValidation(token, challengeCode) {
  const connection = await integrationConnectionModel.findByProviderAndAccount(PROVIDER, token);
  if (!connection) return { httpStatus: 404, body: { message: "Unknown webhook." } };
  if (!challengeCode || typeof challengeCode !== "string") {
    return { httpStatus: 400, body: { message: "Missing challengeCode." } };
  }

  const challengeResponse = computeChallengeResponse(challengeCode, config.linkedin.clientSecret);

  if (!connection.config?.webhookValidated) {
    await integrationConnectionModel.upsert(connection.client_id, PROVIDER, {
      config: { ...connection.config, webhookValidated: true },
    });
  }

  return { httpStatus: 200, body: { challengeCode, challengeResponse } };
}

// leadGenFormResponse URNs are shaped "urn:li:leadGenFormResponse:<id>" —
// the leadFormResponses GET-by-id endpoint takes that trailing <id>
// directly (its own sample response's "id" field is exactly that raw
// value, e.g. "aaaabbbb-0000-cccc-1111-dddd2222eeee-5"), not the full URN.
function leadResponseIdFromUrn(urn) {
  const prefix = "urn:li:leadGenFormResponse:";
  return typeof urn === "string" && urn.startsWith(prefix) ? urn.slice(prefix.length) : null;
}

function formIdFromFormUrn(urn) {
  // "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:123,1)" -> "123";
  // falls back to the raw urn if the shape ever changes so a mapping
  // lookup still has a stable (if less friendly) key to key off of.
  const match = typeof urn === "string" ? urn.match(/urn:li:leadGenForm:(\d+)/) : null;
  return match ? match[1] : urn || "default";
}

// formResponse.answers[] -> the {key, value} shape
// integrationFieldMappingService already expects. Multiple-choice answers
// come back as selected option indexes, not their label text (resolving
// labels requires a separate leadForms schema fetch, out of scope here —
// documented, same "adjust the literal spec where the real schema
// requires it" allowance this whole foundation was built under); they're
// still stably mappable/usable, just joined as raw option ids.
function toRawFields(formResponse) {
  return (formResponse?.answers || []).map((a) => {
    const details = a.answerDetails || {};
    const value = details.textQuestionAnswer?.answer ?? (details.multipleChoiceAnswer?.options || []).join(",");
    return { key: String(a.questionId), value };
  });
}

async function getValidAccessToken(connection) {
  const creds = JSON.parse(decrypt(connection.credentials_encrypted));
  const expiresAt = creds.accessTokenExpiresAt ? new Date(creds.accessTokenExpiresAt).getTime() : null;
  if (!expiresAt || expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
    return creds.accessToken;
  }
  if (!creds.refreshToken) return creds.accessToken; // nothing to refresh with; let the API call fail loudly

  const refreshed = await linkedinClient.refreshAccessToken(creds.refreshToken);
  const newCreds = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || creds.refreshToken,
    accessTokenExpiresAt: tokenExpiryDate(refreshed.expires_in),
    refreshTokenExpiresAt: refreshed.refresh_token_expires_in ? tokenExpiryDate(refreshed.refresh_token_expires_in) : creds.refreshTokenExpiresAt,
  };
  await integrationConnectionModel.upsert(connection.client_id, PROVIDER, { credentialsEncrypted: encrypt(JSON.stringify(newCreds)) });
  return newCreds.accessToken;
}

/**
 * GET /forms — lets the Client Admin pick a form to configure mappings
 * for, instead of having to already know its numeric id (frontend gap
 * discovered building the LinkedIn integration page: unlike Meta's own
 * GET /api/meta/forms, this integration originally had no equivalent).
 * Same shape/reasoning as metaIntegrationService's forms listing: requires
 * a live connection, throws a clear 400 otherwise rather than an empty list.
 */
async function listForms(clientId) {
  const connection = await integrationConnectionModel.findByClientAndProvider(clientId, PROVIDER);
  if (!connection || connection.status !== "connected") {
    throw httpError("Connect a LinkedIn account first.", 400, "LINKEDIN_NOT_CONNECTED");
  }
  const accessToken = await getValidAccessToken(connection);
  return linkedinClient.getLeadForms(connection.config.ownerType, connection.config.ownerUrn, accessToken);
}

/**
 * POST /webhook/:token — the real inbound event delivery. Unlike Google
 * Ads, LinkedIn's notification payload carries no lead answer data (only
 * a pointer, `leadGenFormResponse`), so the actual fetch happens
 * synchronously in-request here — the same shape metaLeadService.
 * processLeadgenEvent already established for the identical "webhook
 * tells you a lead exists, a separate API call gets its data" situation.
 */
async function handleWebhookEvent(token, rawBody, signatureHeader) {
  const connection = await integrationConnectionModel.findByProviderAndAccount(PROVIDER, token);
  if (!connection) {
    return { httpStatus: 404, body: { message: "Unknown webhook." } };
  }
  if (!verifyLinkedInSignature(rawBody, signatureHeader, config.linkedin.clientSecret)) {
    logger.warn(`LinkedIn webhook: signature mismatch for client_id=${connection.client_id}`);
    return { httpStatus: 403, body: { message: "Invalid signature." } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { httpStatus: 400, body: { message: "Malformed JSON body." } };
  }

  if (payload?.type !== "LEAD_ACTION" || !payload?.leadGenFormResponse || !payload?.occurredAt) {
    return { httpStatus: 400, body: { message: "Missing leadGenFormResponse or occurredAt." } };
  }

  const clientId = connection.client_id;

  if (payload.leadAction !== "CREATED") {
    // DELETED (a member un-registering/withdrawing) has no corresponding
    // path in this foundation (ingest() only ever creates leads) — out of
    // scope for this task, acknowledged so LinkedIn doesn't retry it, but
    // deliberately never turned into an integration_events row or a CRM
    // side-effect. Same "acknowledge, don't record, don't ingest" shape
    // Google's is_test handling already uses for its own non-lead pings.
    logger.info(`LinkedIn webhook: leadAction=${payload.leadAction} received for client_id=${clientId}, ignored (no delete path in this foundation).`);
    return { httpStatus: 200, body: {} };
  }

  // LinkedIn's own recommended composite dedup key (leadsync.md
  // "Webhook Deduplication") — the leadGenFormResponse URN alone is
  // reused across register/unregister/re-register cycles for the same
  // member+form, so occurredAt is what makes this pair unique per
  // delivery, fitting integration_events' UNIQUE(provider,
  // external_lead_id) exactly as-is.
  const externalLeadId = `${payload.leadGenFormResponse}_${payload.occurredAt}`;
  const responseId = leadResponseIdFromUrn(payload.leadGenFormResponse);
  if (!responseId) {
    return { httpStatus: 400, body: { message: "Unrecognized leadGenFormResponse URN." } };
  }

  let accessToken;
  let leadResponse;
  try {
    accessToken = await getValidAccessToken(connection);
    leadResponse = await linkedinClient.getLeadFormResponse(responseId, accessToken);
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) {
      // Permanent — an expired/revoked/under-permissioned connection will
      // never succeed on retry. Log and acknowledge so LinkedIn doesn't
      // keep re-delivering an event we can never complete; the Client
      // Admin needs to reconnect, same "token_expired" outcome
      // metaLeadService already treats as a 200-and-move-on.
      logger.error(`LinkedIn webhook: could not fetch lead form response for client_id=${clientId}: ${err.message}`);
      return { httpStatus: 200, body: {} };
    }
    // Transient (network/5xx) — no integration_events row exists yet to
    // let ingestionService's own retry queue pick this up (the row is
    // only created once a normalizedLead is ready, below), so the retry
    // signal here is LinkedIn's own webhook-delivery layer instead.
    logger.warn(`LinkedIn webhook: transient error fetching lead form response for client_id=${clientId}: ${err.message}`);
    return { httpStatus: 500, body: { message: "Temporary error, please retry." } };
  }

  if (leadResponse?.testLead === true) {
    logger.info(`LinkedIn webhook: test lead received for client_id=${clientId}, form=${payload.leadGenForm}`);
    return { httpStatus: 200, body: {} };
  }

  const normalizedLead = {
    provider: PROVIDER,
    clientId,
    externalLeadId,
    externalFormId: formIdFromFormUrn(payload.leadGenForm),
    submittedAt: leadResponse?.submittedAt ? new Date(leadResponse.submittedAt).toISOString() : new Date(payload.occurredAt * 1000).toISOString(),
    rawFields: toRawFields(leadResponse?.formResponse),
    sourceDisplayName: SOURCE_DISPLAY_NAME,
    attribution: {
      leadType: payload.leadType ?? null,
      associatedEntity: payload.associatedEntity ?? null,
      submitter: leadResponse?.submitter ?? null,
    },
    eventType: "lead",
    rawPayload: { notification: payload, leadResponse },
  };

  const result = await ingestionService.ingest(normalizedLead);

  if (result.outcome === "created" || result.outcome === "duplicate" || result.outcome === "skipped") {
    return { httpStatus: 200, body: {} };
  }
  return result.retryable
    ? { httpStatus: 500, body: { message: "Temporary error, please retry." } }
    : { httpStatus: 400, body: { message: result.error || "Could not process this lead." } };
}

module.exports = {
  PROVIDER,
  beginConnect,
  completeConnect,
  getConnection,
  disconnect,
  listForms,
  handleChallengeValidation,
  handleWebhookEvent,
};
