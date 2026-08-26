const config = require("../../config");
const httpError = require("../../utils/httpError");

const BASE_URL = "https://api.razorpay.com/v1";

// Razorpay authenticates server-side API calls with HTTP Basic Auth
// (key_id as username, key_secret as password) — never a bearer token,
// and never sent anywhere near the frontend (see razorpayWebhookService.js
// and billingService.js: the key_secret is read from config here only).
function authHeader() {
  const token = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");
  return `Basic ${token}`;
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: authHeader(), "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
    // was wrong with the request, never anything we sent back) — never
    // echoes the key_secret, and never anything from our own webhook secret.
    throw httpError(data.error?.description || "Razorpay API request failed.", 502, "RAZORPAY_API_ERROR");
  }
  return data;
}

// §D: "create or reuse" — fail_existing: "0" makes Razorpay return the
// existing Customer (matched on email/contact) instead of erroring, which
// is Razorpay's own documented idempotent-create mechanism. We still
// treat the webhook-confirmed customer_id (on the subscription entity) as
// the final authority — see razorpayWebhookService.js.
function createCustomer({ name, email, notes }) {
  return request("POST", "/customers", { name, email, notes, fail_existing: "0" });
}

// Razorpay's subscription-create call does not take a customer_id — the
// customer is matched/attached during Checkout authorization itself, and
// confirmed to us afterward via the webhook's subscription.entity.customer_id
// (§D/§G). total_count is a required technical parameter (Razorpay has no
// "until cancelled" flag) — 100 is used as a large, fixed stand-in for
// "runs until the tenant cancels," not a business term length; see
// docs/API.md for why this isn't "inventing" a contract duration.
const INDEFINITE_TOTAL_COUNT = 100;

function createSubscription({ planId, tenantId, customerNotify = 1 }) {
  return request("POST", "/subscriptions", {
    plan_id: planId,
    total_count: INDEFINITE_TOTAL_COUNT,
    customer_notify: customerNotify,
    notes: { crm_tenant_id: String(tenantId) },
  });
}

function fetchSubscription(razorpaySubscriptionId) {
  return request("GET", `/subscriptions/${razorpaySubscriptionId}`);
}

// §J: Razorpay's real plan-change mechanism — scheduleChangeAt is
// 'now' or 'cycle_end', exactly the two values Razorpay itself supports.
// Nothing else is invented (no proration math, no custom effective dates).
function updateSubscriptionPlan(razorpaySubscriptionId, { planId, scheduleChangeAt }) {
  return request("PATCH", `/subscriptions/${razorpaySubscriptionId}`, {
    plan_id: planId,
    schedule_change_at: scheduleChangeAt,
  });
}

function cancelSubscription(razorpaySubscriptionId, { cancelAtCycleEnd = false } = {}) {
  return request("POST", `/subscriptions/${razorpaySubscriptionId}/cancel`, {
    cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0,
  });
}

// Super Admin "suspend" (§K) — Razorpay's real pause/resume actions, not a
// local-only flag, so a suspended tenant is actually not billed further.
function pauseSubscription(razorpaySubscriptionId) {
  return request("POST", `/subscriptions/${razorpaySubscriptionId}/pause`, { pause_at: "now" });
}
function resumeSubscription(razorpaySubscriptionId) {
  return request("POST", `/subscriptions/${razorpaySubscriptionId}/resume`, { resume_at: "now" });
}

module.exports = {
  createCustomer,
  createSubscription,
  fetchSubscription,
  updateSubscriptionPlan,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
};
