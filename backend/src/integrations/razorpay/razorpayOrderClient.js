const httpError = require("../../utils/httpError");

const BASE_URL = "https://api.razorpay.com/v1";

/**
 * Creates a Razorpay Order against a connected Agency account,
 * authenticated with that Agency's own OAuth access_token (Bearer auth) —
 * verified directly against Razorpay's official "Process Payments for
 * Technology Partners" guide (partners/technology-partners/process-
 * payments.md), which demonstrates exactly this call shape: `POST
 * https://api.razorpay.com/v1/orders` with `Authorization: Bearer
 * <access_token>`, no `X-Razorpay-Account` header — the connected account
 * is implicit in which Agency's access_token is used (confirmed in the
 * Step 8 design report). Deliberately a separate, narrow module from
 * razorpayClient.js (the platform's own Basic-Auth credentials — Agency
 * subscription billing only, untouched by this) and
 * razorpayPartnerClient.js (OAuth code/token exchange against
 * auth.razorpay.com only) — this one, and only this one, calls
 * api.razorpay.com/v1/orders on behalf of a Client purchase.
 */
async function createOrder({ accessToken, amount, currency, receipt, notes }) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount, currency, receipt, notes }),
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
    // Razorpay's own error payload only — the access_token itself travels
    // in the request HEADER, never logged or echoed here, matching
    // razorpayClient.js/razorpayPartnerClient.js's identical discipline.
    throw httpError(data.error?.description || "Razorpay order creation failed.", 502, "RAZORPAY_ORDER_ERROR");
  }

  // Only the safe subset a caller needs to store/return — never the raw
  // Razorpay response object.
  return { id: data.id, amount: data.amount, currency: data.currency, receipt: data.receipt, status: data.status };
}

/**
 * Fetches an existing Order's current status — Step 8E's failed-payment-
 * retry safety check ("do not assume an old Order was paid, but also
 * don't assume it WASN'T"). The official "Fetch an Order With ID" page
 * (api/orders/fetch-with-id.md) only shows this call with the standard
 * key_id/key_secret Basic Auth (i.e. for one's OWN account) — it does NOT
 * explicitly demonstrate Bearer/OAuth usage the way the Technology
 * Partner "Process Payments" guide explicitly did for Order CREATION.
 *
 * This is therefore NOT independently re-verified for the fetch operation
 * specifically — it is a reasonable extension of that guide's own general
 * framing ("You can process payments on behalf of your sub-merchants
 * using Razorpay APIs... authenticate using Bearer Auth", illustrated with
 * Orders creation but not scoped to only that one endpoint), applied here
 * defensively: any failure of this call (including an auth-specific
 * rejection, should Bearer auth not actually be accepted for this
 * particular endpoint) is treated by the caller as "cannot safely
 * determine the old Order's status" and blocks the retry rather than
 * proceeding as if unpaid — see clientBillingService.retryPayment.
 */
async function fetchOrder({ accessToken, orderId }) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/orders/${orderId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
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
    throw httpError(data.error?.description || "Could not verify the previous payment attempt's status.", 502, "RAZORPAY_ORDER_FETCH_ERROR");
  }

  return { id: data.id, status: data.status, amount: data.amount, amountPaid: data.amount_paid, currency: data.currency };
}

module.exports = { createOrder, fetchOrder };
