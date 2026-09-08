const config = require("../../config");
const httpError = require("../../utils/httpError");

const REST_BASE_URL = "https://api.linkedin.com/rest";
const OAUTH_BASE_URL = "https://www.linkedin.com/oauth/v2";

// No timeout was previously set on any outbound LinkedIn call — a bare
// fetch() blocks for as long as the underlying socket stays open, with no
// bound of our own. Applied to every fetch() in this file (restRequest
// and both OAuth token calls): restRequest's getLeadFormResponse is the
// most sensitive case (called in-request, synchronously, from
// linkedinLeadFormService.handleWebhookEvent before the event is ever
// persisted, so an unbounded hang there ties up that request — and its
// DB pool connection — indefinitely), but exchangeCodeForToken/
// refreshAccessToken share the identical bare-fetch shape and deserve
// the same bound rather than being a special case left unprotected. 10s
// is generous for a single call against a healthy API and still bounds
// the worst case to something a caller can reason about.
const REQUEST_TIMEOUT_MS = 10000;

function restHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Linkedin-Version": config.linkedin.apiVersion,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Thin wrapper around LinkedIn's REST API, mirroring graphClient.js's own
 * shape (throw a clear, safe httpError on failure — never log a token,
 * never let a raw LinkedIn error payload reach the client). Distinct
 * failure codes so the caller (linkedinLeadFormService) can tell a
 * permanent auth/permission problem apart from a transient one, same
 * reasoning graphClient.sendCapiEvent's transient flag already applies.
 */
async function restRequest(path, { method = "GET", accessToken, body, query } = {}) {
  const url = new URL(`${REST_BASE_URL}${path}`);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: restHeaders(accessToken),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Covers both a genuine network failure and AbortSignal.timeout()
    // firing (a DOMException named "TimeoutError") — both mean the same
    // thing to the caller: LinkedIn didn't answer in time, treat it as
    // transient and safe to retry, never as a permanent failure.
    throw httpError("Could not reach LinkedIn. Please try again shortly.", 502, "LINKEDIN_UNREACHABLE");
  }

  if (res.status === 204) return { status: res.status, data: null, headers: res.headers };
  const data = await parseJsonSafe(res);

  if (!res.ok) {
    const message = data?.message || "LinkedIn API request failed.";
    // 401/403 mean the stored token/permissions are no good — never worth
    // retrying automatically; everything else (429/5xx/network) is.
    const permanent = res.status === 401 || res.status === 403 || res.status === 400;
    throw httpError(message, permanent ? res.status : 502, "LINKEDIN_API_ERROR");
  }
  return { status: res.status, data, headers: res.headers };
}

// Step 1 of the OAuth exchange — LinkedIn's 3-legged authorization code
// grant. Distinct base URL/host from every other REST call (oauth/v2 vs
// rest), so it's its own small function rather than routed through
// restRequest above.
async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.linkedin.redirectUri,
    client_id: config.linkedin.clientId,
    client_secret: config.linkedin.clientSecret,
  });
  let res;
  try {
    res = await fetch(`${OAUTH_BASE_URL}/accessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Network failure or AbortSignal.timeout() firing — same "didn't
    // answer in time" outcome either way, see restRequest's own comment.
    throw httpError("Could not reach LinkedIn. Please try again shortly.", 502, "LINKEDIN_UNREACHABLE");
  }
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw httpError(data?.error_description || "LinkedIn token exchange failed.", 400, "LINKEDIN_OAUTH_ERROR");
  }
  return data;
}

// Access tokens are short-lived (LinkedIn documents ~60 days); the
// refresh token (documented ~1 year) exchanges for a fresh pair without
// the member re-authorizing. Same grant-type dance as the initial
// exchange, different grant_type value.
async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.linkedin.clientId,
    client_secret: config.linkedin.clientSecret,
  });
  let res;
  try {
    res = await fetch(`${OAUTH_BASE_URL}/accessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Network failure or AbortSignal.timeout() firing — same "didn't
    // answer in time" outcome either way, see restRequest's own comment.
    throw httpError("Could not reach LinkedIn. Please try again shortly.", 502, "LINKEDIN_UNREACHABLE");
  }
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw httpError(data?.error_description || "LinkedIn token refresh failed. Please reconnect.", 400, "LINKEDIN_REFRESH_FAILED");
  }
  return data;
}

// §"Create a Lead Notification Subscription - Owner Level" — the
// recommended flow per LinkedIn's own FAQ ("unless there is an explicit
// need... for unique webhook URLs on a per form or associated entity
// basis, we recommend creating subscriptions at the owner level").
// Returns the created subscription's id from the x-restli-id response
// header when present (used only for best-effort cleanup on disconnect).
async function createLeadNotificationSubscription({ webhook, ownerType, ownerUrn, leadType = "SPONSORED" }, accessToken) {
  const { headers } = await restRequest("/leadNotifications", {
    method: "POST",
    accessToken,
    body: { webhook, owner: { [ownerType]: ownerUrn }, leadType },
  });
  return headers.get("x-restli-id") || headers.get("X-RestLi-Id") || null;
}

async function deleteLeadNotificationSubscription(subscriptionId, accessToken) {
  await restRequest(`/leadNotifications/${encodeURIComponent(subscriptionId)}`, { method: "DELETE", accessToken });
}

// §"Get a single Lead Form Response" — the required follow-up call every
// LEAD_ACTION notification triggers, since the notification payload
// itself carries no answer data (unlike Google Ads' webhook). `id` is the
// leadFormResponses record id, NOT the full leadGenFormResponse URN — see
// linkedinLeadFormService.leadResponseIdFromUrn for how that's derived.
async function getLeadFormResponse(id, accessToken) {
  const { data } = await restRequest(`/leadFormResponses/${encodeURIComponent(id)}`, { accessToken });
  return data;
}

module.exports = {
  exchangeCodeForToken,
  refreshAccessToken,
  createLeadNotificationSubscription,
  deleteLeadNotificationSubscription,
  getLeadFormResponse,
};
