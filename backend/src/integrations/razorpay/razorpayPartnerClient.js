const config = require("../../config");
const httpError = require("../../utils/httpError");

// Razorpay's OAuth token endpoint — a DIFFERENT host and credential set
// from the platform's own api.razorpay.com Basic-Auth client
// (razorpayClient.js, untouched by this file). This is the Technology
// Partner OAuth flow verified in Step 3 research: authorization_code and
// refresh_token grants both POST here, both authenticated with the
// Partner app's own client_id/client_secret (config.razorpayPartner) —
// never the merchant's, and never the platform's RAZORPAY_KEY_ID/SECRET.
const AUTH_BASE_URL = "https://auth.razorpay.com";

async function request(path, body) {
  let res;
  try {
    res = await fetch(`${AUTH_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw httpError("Could not reach Razorpay. Please try again shortly.", 502, "RAZORPAY_UNREACHABLE");
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw httpError("Razorpay returned an unexpected response.", 502, "RAZORPAY_BAD_RESPONSE");
  }

  if (!res.ok || data.error) {
    // Razorpay's own error payload is safe to summarize (describes what
    // was wrong with the request) — never the request body itself (which
    // carries client_secret/code/refresh_token), matching razorpayClient.js's
    // existing discipline for the platform-account client.
    throw httpError(data.error_description || data.error || "Razorpay OAuth request failed.", 502, "RAZORPAY_OAUTH_ERROR");
  }
  return data;
}

// §D of the Step 3 verification report — exact fields confirmed directly
// against Razorpay's own documented example: request takes client_id,
// client_secret, grant_type, redirect_uri, code, mode; response includes
// access_token, refresh_token, expires_in, public_token, and
// razorpay_account_id. `mode` is shown as "test" in Razorpay's own
// example — mapped here to "live" in production by inference (not itself
// shown in an official example for a live exchange); flagged in the
// implementation report rather than silently presented as fully verified.
function exchangeCodeForToken(code) {
  return request("/token", {
    client_id: config.razorpayPartner.clientId,
    client_secret: config.razorpayPartner.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: config.razorpayPartner.redirectUri,
    code,
    mode: config.isProduction ? "live" : "test",
  });
}

// Same endpoint, refresh_token grant — response does NOT include
// razorpay_account_id (confirmed from Razorpay's own documented example),
// only public_token/token_type/expires_in/access_token/refresh_token, so
// callers must keep the existing stored account id unchanged on refresh.
function refreshAccessToken(refreshToken) {
  return request("/token", {
    client_id: config.razorpayPartner.clientId,
    client_secret: config.razorpayPartner.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

module.exports = { exchangeCodeForToken, refreshAccessToken };
