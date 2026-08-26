const config = require("../../config");
const httpError = require("../../utils/httpError");

const BASE_URL = `https://graph.facebook.com/${config.meta.graphApiVersion}`;

/**
 * Thin wrapper around Meta's Graph API. Every function here throws a
 * clear, safe httpError on failure (§L: "fail safely when Meta API calls
 * fail", "validate external API responses") — never logs a token, never
 * lets a raw Meta error payload reach the client.
 */
async function graphRequest(path, { method = "GET", params, accessToken } = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  if (accessToken) url.searchParams.set("access_token", accessToken);

  let res;
  try {
    res = await fetch(url, { method });
  } catch {
    throw httpError("Could not reach Meta. Please try again shortly.", 502, "META_UNREACHABLE");
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw httpError("Meta returned an unexpected response.", 502, "META_BAD_RESPONSE");
  }

  if (!res.ok || data.error) {
    // Meta's own error payload is safe to summarize (no secrets in it),
    // but never echo the request URL/token back.
    throw httpError(data.error?.message || "Meta API request failed.", 502, "META_API_ERROR");
  }
  return data;
}

// Step 1 of the OAuth exchange — the short-lived user access token.
function exchangeCodeForToken(code) {
  return graphRequest("/oauth/access_token", {
    params: {
      client_id: config.meta.appId,
      client_secret: config.meta.appSecret,
      redirect_uri: config.meta.redirectUri,
      code,
    },
  });
}

// Step 2 — trade the short-lived token for a long-lived one (~60 days).
function exchangeForLongLivedToken(shortLivedToken) {
  return graphRequest("/oauth/access_token", {
    params: {
      grant_type: "fb_exchange_token",
      client_id: config.meta.appId,
      client_secret: config.meta.appSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
}

// The pages this user manages, each with its own page-scoped access
// token — leads are retrieved with a PAGE token, not the user token.
function getPages(userAccessToken) {
  return graphRequest("/me/accounts", {
    params: { fields: "id,name,access_token" },
    accessToken: userAccessToken,
  });
}

function getAdAccounts(userAccessToken) {
  return graphRequest("/me/adaccounts", {
    params: { fields: "id,name" },
    accessToken: userAccessToken,
  });
}

// §E: the full lead record — field_data is the array of {name, values}
// pairs the field-mapping step (§F) consumes.
function fetchLead(leadgenId, pageAccessToken) {
  return graphRequest(`/${leadgenId}`, {
    params: { fields: "id,form_id,field_data,created_time,ad_id,page_id" },
    accessToken: pageAccessToken,
  });
}

// §I: "see connected Meta forms where available".
function getLeadForms(pageId, pageAccessToken) {
  return graphRequest(`/${pageId}/leadgen_forms`, {
    params: { fields: "id,name,status" },
    accessToken: pageAccessToken,
  });
}

/**
 * Step 8 — Conversions API: sends one server-side event to a tenant's own
 * Pixel/Dataset. Deliberately does NOT reuse graphRequest()'s throw-on-
 * error behavior: metaCapiService needs to tell a transient failure
 * (worth retrying) apart from a permanent one (never will succeed) to
 * implement retry-with-backoff correctly, so this returns a structured
 * result either way instead of throwing. Still the same module, same
 * BASE_URL, same fetch() — not a second, unrelated HTTP client.
 */
async function sendCapiEvent(pixelId, accessToken, eventPayload) {
  const url = new URL(`${BASE_URL}/${pixelId}/events`);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [eventPayload], access_token: accessToken }),
    });
  } catch {
    return { ok: false, transient: true, code: "NETWORK_ERROR", message: "Could not reach Meta." };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, transient: true, code: "BAD_RESPONSE", message: "Meta returned an unexpected response." };
  }

  if (res.ok && !data.error) {
    return { ok: true, eventsReceived: data.events_received, fbtraceId: data.fbtrace_id };
  }

  const error = data.error || {};
  // Meta's error payload often carries `is_transient` directly; fall back
  // to HTTP status when it's absent — 5xx/429 are worth retrying, anything
  // else (400 validation, 401/403 auth) is a permanent, retry-proof failure.
  const transient = typeof error.is_transient === "boolean" ? error.is_transient : res.status >= 500 || res.status === 429;
  return {
    ok: false,
    transient,
    code: String(error.code ?? res.status),
    subcode: error.error_subcode,
    message: error.message || "Meta API request failed.",
  };
}

module.exports = {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getPages,
  getAdAccounts,
  fetchLead,
  getLeadForms,
  sendCapiEvent,
};
