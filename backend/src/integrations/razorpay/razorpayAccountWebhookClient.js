const httpError = require("../../utils/httpError");

const BASE_URL = "https://api.razorpay.com/v2";

/**
 * Creates a webhook on a connected Agency account — verified directly
 * against Razorpay's official "Create a Webhook" Partner API
 * (api/partners/webhooks/create.md). Confirmed this session:
 *   - `secret` is an INPUT parameter WE choose and supply, NOT something
 *     Razorpay generates and returns — the response only ever echoes back
 *     a `secret_exists: true` boolean, never the secret value itself. This
 *     is the same "you configure your own secret" model this codebase's
 *     platform webhook already uses (RAZORPAY_WEBHOOK_SECRET, set in the
 *     Dashboard by a human) — here just done once per Agency,
 *     programmatically, at connect time.
 *   - Authenticated the same way Order creation already is for this
 *     Partner integration (razorpayOrderClient.js): `Authorization: Bearer
 *     <access_token>`, the Agency's own OAuth token — every code sample on
 *     this API's doc page uses a single-argument RazorpayClient([ACCESS_TOKEN])
 *     construction, the SDKs' own convention for Bearer/OAuth auth.
 *   - `account_id` is a PATH parameter (not a header), `url`/`events` are
 *     required, `alert_email` optional.
 *
 * A SEPARATE, narrow module from razorpayOrderClient.js (Orders API) and
 * razorpayPartnerClient.js (OAuth code/token exchange only, auth.razorpay.com)
 * — this one, and only this one, calls api.razorpay.com/v2/accounts/*\/webhooks.
 */
async function createAccountWebhook({ accessToken, accountId, url, events, secret, alertEmail }) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/accounts/${accountId}/webhooks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, events, secret, ...(alertEmail ? { alert_email: alertEmail } : {}) }),
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
    // Razorpay's own error payload only — the secret and access_token
    // themselves travel in the request body/header, never logged or
    // echoed here, matching every other Razorpay integration module's
    // discipline in this codebase.
    throw httpError(data.error?.description || "Razorpay webhook provisioning failed.", 502, "RAZORPAY_WEBHOOK_PROVISION_ERROR");
  }

  // Only the safe subset a caller needs — never the raw response (which,
  // per the doc, never contains the secret anyway, but kept narrow
  // regardless, matching this codebase's established convention).
  return { id: data.id, active: !!data.active, secretExists: !!data.secret_exists };
}

module.exports = { createAccountWebhook };
