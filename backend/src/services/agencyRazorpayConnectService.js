const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const tenantRazorpayAccountModel = require("../models/tenantRazorpayAccountModel");
const razorpayPartnerClient = require("../integrations/razorpay/razorpayPartnerClient");
const razorpayAccountWebhookClient = require("../integrations/razorpay/razorpayAccountWebhookClient");
const { encrypt, decrypt } = require("../utils/encryption");
const httpError = require("../utils/httpError");
const logger = require("../utils/logger");
const config = require("../config");

// Step 8D's webhook handler only reconciles these three events — request
// exactly this set, nothing broader, matching the codebase's existing
// "handle only what's needed" convention (see razorpayWebhookService.js's
// own comment on the same principle).
const CLIENT_PAYMENT_WEBHOOK_EVENTS = ["order.paid", "payment.captured", "payment.failed"];

// Step 3 verification: read_write is the OAuth scope whose consent text
// explicitly names "subscriptions" among what it grants — requested once,
// up front, at connection time, since OAuth scope can't be silently
// upgraded later without re-authorizing. This step never itself calls a
// Subscriptions/Plans API (that's future Client-billing work) — only
// stores the resulting token for later use.
const OAUTH_SCOPE = "read_write";
const STATE_EXPIRY = "10m";

// Refresh proactively once the access token is within this window of its
// documented ~90-day validity — a lazy/on-demand check (no scheduler
// exists in this codebase, the same documented limitation as Step 4's
// grace-period handling), so this buffer just needs to comfortably exceed
// how long it might be between one caller checking and the next.
const REFRESH_BUFFER_MS = 7 * 24 * 60 * 60 * 1000;

function requirePartnerConfig() {
  if (!config.razorpayPartner.clientId || !config.razorpayPartner.clientSecret) {
    throw httpError("Razorpay account connection is not configured on this platform yet.", 503, "RAZORPAY_PARTNER_NOT_CONFIGURED");
  }
}

/**
 * The OAuth `state` param — mirrors metaIntegrationService's issueState/
 * verifyState exactly (same reasoning: signed with the JWT secret already
 * used for access tokens, no new secret/infra; short-lived; a distinct
 * `purpose` so it can never be confused with a real access token or
 * Meta's own OAuth state). This IS the CSRF protection: the callback is a
 * plain browser GET redirect with no Authorization header possible (see
 * completeConnect), so a valid signature + unexpired `exp` + matching
 * `purpose` is the entire trust boundary — only this server could have
 * signed it, and only during a `connect` call this same Agency Admin's
 * own authenticated session made.
 *
 * True single-use (server-side consumption tracking) is NOT implemented —
 * doing so would need a new table/column this step's instructions
 * restrict against creating without a genuine schema gap, and none
 * exists here. In practice this doesn't weaken the flow: Razorpay's own
 * authorization `code` is itself single-use per the OAuth standard (a
 * repeated exchange of the same code fails at Razorpay's end), so even a
 * captured state+code pair can only ever be exchanged once. Documented
 * here rather than silently claimed as fully single-use.
 */
function issueState(tenantId, adminUserId) {
  return jwt.sign({ tenantId, adminUserId, purpose: "razorpay_partner_oauth" }, config.jwt.accessSecret, { expiresIn: STATE_EXPIRY });
}

function verifyState(state) {
  try {
    const payload = jwt.verify(state, config.jwt.accessSecret);
    if (payload.purpose !== "razorpay_partner_oauth") throw new Error("wrong purpose");
    return payload;
  } catch {
    throw httpError("This connection link has expired or is invalid. Please start over from the CRM.", 400, "RAZORPAY_OAUTH_STATE_INVALID");
  }
}

// Never includes access_token_encrypted/refresh_token_encrypted or
// anything derived from them — the only thing this ever returns to an API
// response. webhookProvisioned (Step 8E) is a derived boolean, not a raw
// column — true only once BOTH the OAuth connection is 'connected' AND a
// Client-payment webhook secret has actually been stored; a connection can
// be genuinely 'connected' while this is still false (webhook
// provisioning failed or hasn't run yet), which is exactly the state
// clientBillingService.chooseSubscription/retryPayment must refuse to
// start a purchase against — see requireClientPaymentsReady below.
function serializeConnection(account) {
  if (!account) return { status: "disconnected", razorpayAccountId: null, connectedAt: null, tokenExpiresAt: null, webhookProvisioned: false };
  return {
    status: account.status,
    razorpayAccountId: account.razorpay_account_id,
    connectedAt: account.connected_at,
    tokenExpiresAt: account.token_expires_at,
    webhookProvisioned: account.status === "connected" && !!account.webhook_secret_encrypted,
  };
}

async function getConnection(tenantId) {
  // Reads the row WITH webhook_secret_encrypted (never selected by the
  // plain findByTenant) purely so serializeConnection can derive the safe
  // webhookProvisioned boolean below — the encrypted value itself is
  // discarded, never included in what serializeConnection returns, same
  // pattern already used for access_token_encrypted/refresh_token_encrypted
  // elsewhere in this file (refreshIfNeeded/getValidAccessToken).
  const account = await tenantRazorpayAccountModel.findByTenantWithWebhookSecret(tenantId);
  return serializeConnection(account);
}

function beginConnect(tenantId, adminUserId) {
  requirePartnerConfig();
  const state = issueState(tenantId, adminUserId);
  const url = new URL("https://auth.razorpay.com/authorize");
  url.searchParams.set("client_id", config.razorpayPartner.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.razorpayPartner.redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPE);
  url.searchParams.set("state", state);
  return { authorizationUrl: url.toString() };
}

/**
 * The callback Razorpay redirects the browser back to. Tenant identity
 * comes ENTIRELY from the verified `state` payload — this request cannot
 * carry our own Authorization header (it's a third-party redirect, not a
 * fetch() call our frontend makes), so there is no live session to check
 * against here, by design of the OAuth redirect flow itself.
 */
async function completeConnect(code, state) {
  requirePartnerConfig();
  const { tenantId } = verifyState(state);

  const tokenResponse = await razorpayPartnerClient.exchangeCodeForToken(code);
  if (!tokenResponse.access_token || !tokenResponse.refresh_token || !tokenResponse.razorpay_account_id) {
    // Verified against Razorpay's own documented example response, which
    // always includes these three fields for an authorization_code grant
    // — a response missing any of them is treated as an integration
    // error, never silently stored as a partial/guessed connection.
    throw httpError("Razorpay did not return a complete connection response.", 502, "RAZORPAY_OAUTH_INCOMPLETE_RESPONSE");
  }

  // Read BEFORE upserting — needed to detect "is this the SAME Razorpay
  // account as before, or a genuinely different one" (Step 8E), which
  // decides whether a previously-stored webhook secret is still valid.
  const existingBefore = await tenantRazorpayAccountModel.findByTenant(tenantId);
  const isSameAccountAsBefore = existingBefore?.razorpay_account_id === tokenResponse.razorpay_account_id;

  const tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
  const account = await tenantRazorpayAccountModel.upsertConnected(tenantId, {
    razorpayAccountId: tokenResponse.razorpay_account_id,
    // Step 8C (migration 049): captured now — Step 5 received this in the
    // same response but never persisted it. Not a secret (see that
    // migration's comment), stored plainly alongside razorpay_account_id.
    publicToken: tokenResponse.public_token || null,
    accessTokenEncrypted: encrypt(tokenResponse.access_token),
    refreshTokenEncrypted: encrypt(tokenResponse.refresh_token),
    tokenExpiresAt,
    // A stale secret from a DIFFERENT previously-connected account must
    // never be left looking "already provisioned" for this new one.
    clearWebhookSecret: !isSameAccountAsBefore,
  });

  // Step 8E: provision the Client-payment webhook for this account —
  // idempotent (skipped if this exact account already has a secret
  // stored), and never lets a provisioning failure silently claim the
  // Agency is ready for Client payments (see serializeConnection's
  // webhookProvisioned and requireClientPaymentsReady below). The OAuth
  // connection itself is already committed above regardless of the
  // outcome here — "keep the OAuth connection intact" even if this fails.
  await provisionClientPaymentWebhookIfNeeded(tenantId, tokenResponse.razorpay_account_id, tokenResponse.access_token);

  return getConnection(tenantId);
}

/**
 * Step 8E — Task 1. Creates a Client-payment webhook on the connected
 * Agency account via Razorpay's official "Create a Webhook" Partner API
 * (verified this session — see razorpayAccountWebhookClient.js's header
 * comment for the exact request/response shape and auth mechanism).
 *
 * WE generate the secret (Razorpay's `secret` parameter is an INPUT we
 * supply, not an output it generates — the response only ever echoes
 * `secret_exists: true`, confirmed directly against the official docs) —
 * a cryptographically random 32-byte value, encrypted at rest exactly
 * like access_token/refresh_token (utils/encryption.js, unchanged).
 *
 * Idempotent: skipped entirely if this exact (tenant, account) pairing
 * already has a stored secret — prevents creating duplicate webhook
 * registrations on Razorpay's side for repeat calls (e.g. a token refresh
 * that happens to run through completeConnect-adjacent code, or an Agency
 * Admin re-authorizing the same already-connected account).
 *
 * Never throws — a failure here must not fail the OAuth connection itself
 * (which already succeeded and is already committed by the time this
 * runs); it only logs and leaves webhook_secret_encrypted unset, which
 * chooseSubscription/retryPayment's own readiness check will correctly
 * refuse to proceed past until a future call succeeds.
 */
async function provisionClientPaymentWebhookIfNeeded(tenantId, razorpayAccountId, accessToken) {
  const current = await tenantRazorpayAccountModel.findByTenantWithWebhookSecret(tenantId);
  if (current?.webhook_secret_encrypted) {
    return { outcome: "already_provisioned" };
  }

  const secret = crypto.randomBytes(32).toString("hex");
  try {
    await razorpayAccountWebhookClient.createAccountWebhook({
      accessToken,
      accountId: razorpayAccountId,
      url: config.razorpayPartner.clientWebhookUrl,
      events: CLIENT_PAYMENT_WEBHOOK_EVENTS,
      secret,
    });
  } catch (err) {
    logger.warn(`Client payment webhook provisioning failed for tenant_id=${tenantId}: ${err.message}`);
    return { outcome: "provisioning_failed" };
  }

  await tenantRazorpayAccountModel.setWebhookSecret(tenantId, encrypt(secret));
  return { outcome: "provisioned" };
}

/**
 * Step 8E — the readiness gate clientBillingService must check before
 * ever creating a Client Order: OAuth 'connected' alone is NOT sufficient
 * ("mark connection usable for Client payments" only once the webhook is
 * ALSO provisioned) — without a working webhook, a successful payment
 * could never be locally confirmed, silently taking a Client's money with
 * no activation path. Returns the full serialized connection either way,
 * so a caller can report exactly what's missing.
 */
async function requireClientPaymentsReady(tenantId) {
  const connection = await getConnection(tenantId);
  if (connection.status !== "connected") {
    throw httpError(
      "Your agency has not connected a Razorpay account yet. Ask your agency administrator to connect one before subscribing.",
      400,
      "AGENCY_RAZORPAY_NOT_CONNECTED"
    );
  }
  if (!connection.webhookProvisioned) {
    throw httpError(
      "Your agency's Razorpay connection is not yet fully set up for Client payments. Ask your agency administrator to reconnect it.",
      400,
      "AGENCY_RAZORPAY_WEBHOOK_NOT_PROVISIONED"
    );
  }
  return connection;
}

/**
 * Application-side disconnect only — clears our own stored tokens and
 * marks the row disconnected. Deliberately does NOT call any Razorpay API
 * to revoke the grant on Razorpay's side: no partner-initiated revocation
 * endpoint was found/verified during research (only the merchant's own
 * Razorpay Dashboard can fully revoke the underlying authorization — see
 * handleAuthorizationRevoked below, which is what runs when THEY do
 * that). This is a real, useful safety action (we immediately stop being
 * able to use the stored tokens) but is not a full OAuth revocation —
 * documented as a known limitation, not silently presented as one.
 */
async function disconnect(tenantId) {
  const updated = await tenantRazorpayAccountModel.markDisconnectedByTenant(tenantId);
  if (!updated) throw httpError("No Razorpay connection found for this agency.", 404, "RAZORPAY_NOT_CONNECTED");
  return serializeConnection(updated);
}

/**
 * Razorpay-initiated revocation — account.app.authorization_revoked
 * (razorpayPartnerWebhook.controller.js). Looked up by razorpay_account_id,
 * the only identifier that event carries; a plain WHERE razorpay_account_id
 * = ? update structurally cannot affect any other agency's row.
 */
async function handleAuthorizationRevoked(razorpayAccountId) {
  const updated = await tenantRazorpayAccountModel.markDisconnectedByAccountId(razorpayAccountId);
  if (!updated) {
    logger.warn(`Razorpay Partner webhook: authorization_revoked for unknown account_id=${razorpayAccountId}`);
    return { outcome: "unknown_account", tenantId: null };
  }
  return { outcome: "disconnected", tenantId: updated.tenant_id };
}

/**
 * Razorpay's documented refresh_token grant (Step 3, confirmed against
 * the official example response). Lazy/on-demand — intended to be called
 * before any future use of the stored access token (a future Client-
 * billing API call), not on a background timer; no scheduler exists in
 * this codebase to drive this proactively. Refresh failure (e.g. the
 * refresh_token itself was revoked/expired at Razorpay's end) marks the
 * connection disconnected rather than leaving a connection that LOOKS
 * connected but silently can't be used — the Agency Admin is prompted to
 * reconnect, matching the revocation UX exactly.
 */
async function refreshIfNeeded(tenantId) {
  const account = await tenantRazorpayAccountModel.findByTenantWithSecrets(tenantId);
  if (!account || account.status !== "connected") return serializeConnection(account);

  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return serializeConnection(account); // not due yet
  }

  try {
    const refreshToken = decrypt(account.refresh_token_encrypted);
    const tokenResponse = await razorpayPartnerClient.refreshAccessToken(refreshToken);
    if (!tokenResponse.access_token || !tokenResponse.refresh_token) {
      throw httpError("Razorpay did not return a complete refresh response.", 502, "RAZORPAY_OAUTH_INCOMPLETE_RESPONSE");
    }
    const tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
    const updated = await tenantRazorpayAccountModel.updateTokens(tenantId, {
      accessTokenEncrypted: encrypt(tokenResponse.access_token),
      refreshTokenEncrypted: encrypt(tokenResponse.refresh_token),
      tokenExpiresAt,
      // Razorpay's documented refresh_token-grant response also includes a
      // fresh public_token — kept in sync here too, not just at initial connect.
      publicToken: tokenResponse.public_token || null,
    });
    return serializeConnection(updated);
  } catch (err) {
    logger.warn(`Razorpay Partner token refresh failed for tenant_id=${tenantId}: ${err.message}`);
    const disconnected = await tenantRazorpayAccountModel.markDisconnectedByTenant(tenantId);
    return serializeConnection(disconnected);
  }
}

/**
 * Step 8B/8C: the one call site a Client-Order-creation/Checkout flow
 * needs — ensures the token is fresh (delegates to refreshIfNeeded, which
 * may mark the connection disconnected on an unrecoverable refresh
 * failure) and returns BOTH the DECRYPTED access_token (server-side
 * Razorpay API calls only — never returned in any HTTP response, mirroring
 * metaIntegrationService.getDecryptedAccessToken's exact discipline one
 * level up) and the public_token (safe for the frontend — see migration
 * 049's comment — the only field from this return value a controller may
 * ever put in an API response). Returns null (never throws) when there is
 * no usable connection, so callers can turn that into their own clear
 * "Agency not connected" error.
 */
async function getValidAccessToken(tenantId) {
  const refreshed = await refreshIfNeeded(tenantId);
  if (!refreshed || refreshed.status !== "connected") return null;

  const account = await tenantRazorpayAccountModel.findByTenantWithSecrets(tenantId);
  if (!account || account.status !== "connected" || !account.access_token_encrypted) return null;
  return { accessToken: decrypt(account.access_token_encrypted), publicToken: account.public_token };
}

module.exports = {
  getConnection,
  beginConnect,
  completeConnect,
  disconnect,
  handleAuthorizationRevoked,
  refreshIfNeeded,
  getValidAccessToken,
  requireClientPaymentsReady,
  // Exported for direct testing (mocking razorpayPartnerClient/
  // razorpayAccountWebhookClient) without going through the HTTP layer —
  // see the implementation report.
  provisionClientPaymentWebhookIfNeeded,
  verifyState,
  issueState,
};
