const subscriptionModel = require("../models/subscriptionModel");
const subscriptionPlanModel = require("../models/subscriptionPlanModel");
const paymentModel = require("../models/paymentModel");
const tenantModel = require("../models/tenantModel");
const subscriptionPlanService = require("./subscriptionPlanService");
const razorpayClient = require("../integrations/razorpay/razorpayClient");
const httpError = require("../utils/httpError");
const config = require("../config");
const { validateSubscribeBody, validatePlanChangeBody } = require("../validators/billingValidators");

function serializeSubscription(subscription) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    planId: subscription.plan_id,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at,
    // Not a secret (just an identifier, same trust level as our own
    // numeric id) — the frontend needs it to reopen Razorpay Checkout for
    // a subscription that's still pending payment (e.g. the tenant closed
    // the modal without finishing). razorpay_customer_id and the access
    // token stay server-side only; see razorpayClient.js.
    razorpaySubscriptionId: subscription.razorpay_subscription_id,
  };
}

function serializePlanSummary(plan) {
  if (!plan) return null;
  return { id: plan.id, name: plan.name, price: plan.price, currency: plan.currency, billingCycle: plan.billing_cycle };
}

/**
 * Used by both the tenant's own billing page and Super Admin's tenant
 * detail view (§K: "use the same underlying subscription service logic
 * where possible") — WHICH tenantId a caller may pass in is decided
 * entirely by the route layer (own tenant only vs. any tenant), never
 * here. Includes a plan summary alongside the raw subscription row so
 * neither UI needs a second round-trip just to show a plan name.
 */
async function getSubscriptionForTenant(tenantId) {
  const subscription = await subscriptionModel.findByTenant(tenantId);
  if (!subscription) return { subscription: null, plan: null };
  const plan = await subscriptionPlanModel.findById(subscription.plan_id);
  return { subscription: serializeSubscription(subscription), plan: serializePlanSummary(plan) };
}

async function listPaymentsForTenant(tenantId) {
  return paymentModel.listForTenant(tenantId, 50);
}

/**
 * §C/§D: the initial signup-time subscribe flow. Tenant-only (never
 * called for another tenant — see billing.routes.js), and only valid once
 * per tenant: an existing subscription means changePlan() is the right
 * operation, not this.
 */
async function subscribe(tenantId, actorUser, body) {
  const { planId } = validateSubscribeBody(body);

  const existing = await subscriptionModel.findByTenant(tenantId);
  if (existing) {
    throw httpError("This tenant already has a subscription. Use the plan-change endpoint instead.", 409, "SUBSCRIPTION_ALREADY_EXISTS");
  }

  const plan = await subscriptionPlanService.requireActivePlan(planId);
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw httpError("Tenant not found.", 404);

  // §D.3: create-or-reuse — Razorpay's own idempotent-create mechanism
  // (fail_existing: "0" in razorpayClient.createCustomer), keyed on the
  // signing-up admin's own account, not any client-supplied identity.
  const customer = await razorpayClient.createCustomer({
    name: actorUser.name,
    email: actorUser.email,
    notes: { crm_tenant_id: String(tenantId) },
  });

  // §D.4: the backend resolves the Razorpay Plan ID from the LOCAL plan —
  // the frontend only ever sends our own local planId (validated above),
  // never a Razorpay identifier directly (§D: "do not allow the frontend
  // to decide the Razorpay Plan ID").
  const razorpaySubscription = await razorpayClient.createSubscription({ planId: plan.razorpay_plan_id, tenantId });

  const subscription = await subscriptionModel.create(null, {
    tenantId,
    planId: plan.id,
    razorpaySubscriptionId: razorpaySubscription.id,
    razorpayCustomerId: customer.id,
    status: razorpaySubscription.status || "created",
  });

  // §D.6/§E: only what Razorpay Checkout itself needs — a public key id
  // (meant to be visible to the browser by design, unlike key_secret) and
  // the subscription id it was just told to open. No amount/plan details
  // are needed by Checkout for a subscription flow (it reads them from
  // the subscription_id server-side, on Razorpay's own end).
  return {
    subscription: serializeSubscription(subscription),
    checkout: {
      razorpayKeyId: config.razorpay.keyId,
      razorpaySubscriptionId: razorpaySubscription.id,
      planName: plan.name,
      amount: plan.price,
      currency: plan.currency,
    },
  };
}

/**
 * §J/§K: shared by both the Tenant Admin ("own tenant only") and Super
 * Admin ("any tenant") routes — authorization is entirely the route
 * layer's job; this function just needs a tenantId it can trust.
 */
async function changePlan(tenantId, body) {
  const { planId, timing } = validatePlanChangeBody(body);

  const subscription = await subscriptionModel.findByTenant(tenantId);
  if (!subscription) throw httpError("No subscription found for this tenant.", 404, "NO_SUBSCRIPTION");

  if (["cancelled", "completed", "expired"].includes(subscription.status)) {
    throw httpError("This subscription has ended — a new subscription is required instead of a plan change.", 409, "SUBSCRIPTION_ENDED");
  }

  const plan = await subscriptionPlanService.requireActivePlan(planId);
  if (plan.id === subscription.plan_id) {
    throw httpError("The subscription is already on this plan.", 400, "ALREADY_ON_PLAN");
  }

  // §J: Razorpay's actual supported mechanism only — 'now' or 'cycle_end',
  // nothing invented. The LOCAL subscriptions.plan_id is deliberately NOT
  // updated here even for timing='now': only the webhook (subscription.
  // updated, carrying Razorpay's own confirmed entity.plan_id) writes it,
  // so this never claims a change is active before Razorpay has actually
  // confirmed it (§J: "do not prematurely overwrite the effective local
  // plan").
  const result = await razorpayClient.updateSubscriptionPlan(subscription.razorpay_subscription_id, {
    planId: plan.razorpay_plan_id,
    scheduleChangeAt: timing,
  });

  return {
    requestedPlan: { id: plan.id, name: plan.name },
    timing,
    razorpayStatus: result.status,
    // Surfaced as Razorpay itself reports it — never asserted locally.
    // (§J: "expose the actual supported behavior to the UI clearly".)
    message:
      timing === "now"
        ? "Plan change requested for immediate effect. It will be confirmed once Razorpay processes it."
        : "Plan change scheduled for the end of the current billing cycle. It will be confirmed by Razorpay at that time.",
  };
}

/**
 * §K: Super Admin only. Maps to Razorpay's real pause action — not a
 * local-only flag — so a "suspended" tenant is actually not billed
 * further, not just blocked from the CRM while Razorpay keeps charging it.
 * Unlike webhook-driven activation (§H), this DOES update tenants.status
 * immediately: the trigger here is a synchronous, our-own-backend-
 * authenticated Razorpay API response (Basic Auth, server-to-server), not
 * an unverified client redirect — there is nothing further to "wait and
 * verify" the way a browser checkout callback would require.
 */
async function suspend(tenantId) {
  const subscription = await subscriptionModel.findByTenant(tenantId);
  if (!subscription) throw httpError("No subscription found for this tenant.", 404, "NO_SUBSCRIPTION");

  await razorpayClient.pauseSubscription(subscription.razorpay_subscription_id);
  const tenant = await tenantModel.updateStatus(tenantId, "suspended");
  return tenant;
}

async function resume(tenantId) {
  const subscription = await subscriptionModel.findByTenant(tenantId);
  if (!subscription) throw httpError("No subscription found for this tenant.", 404, "NO_SUBSCRIPTION");

  await razorpayClient.resumeSubscription(subscription.razorpay_subscription_id);
  const tenant = await tenantModel.updateStatus(tenantId, "active");
  return tenant;
}

/**
 * §K: Super Admin only. Same synchronous-confirmation reasoning as
 * suspend() above.
 */
async function cancel(tenantId) {
  const subscription = await subscriptionModel.findByTenant(tenantId);
  if (!subscription) throw httpError("No subscription found for this tenant.", 404, "NO_SUBSCRIPTION");

  await razorpayClient.cancelSubscription(subscription.razorpay_subscription_id, { cancelAtCycleEnd: false });
  const tenant = await tenantModel.updateStatus(tenantId, "canceled");
  return tenant;
}

module.exports = {
  getSubscriptionForTenant,
  listPaymentsForTenant,
  subscribe,
  changePlan,
  suspend,
  resume,
  cancel,
  serializeSubscription,
};
