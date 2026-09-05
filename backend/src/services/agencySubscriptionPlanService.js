const agencySubscriptionPlanModel = require("../models/agencySubscriptionPlanModel");
const auditLogModel = require("../models/auditLogModel");
const httpError = require("../utils/httpError");
const { validateUpsertAgencyPlan } = require("../validators/agencySubscriptionValidators");

// Super Admin's own view — full record.
async function get() {
  return agencySubscriptionPlanModel.get();
}

// What an anonymous visitor on the self-service signup page may see:
// never razorpay_plan_id (an internal reference, not user-facing), and
// nothing at all when the plan isn't active yet — signup should present as
// "not available", not a broken/partial price.
function serializePublic(plan) {
  if (!plan || !plan.is_active) return null;
  return { price: plan.price, currency: plan.currency, billingCycle: plan.billing_cycle };
}

async function getPublic() {
  return serializePublic(await agencySubscriptionPlanModel.get());
}

async function upsert(body, actorUserId) {
  const clean = validateUpsertAgencyPlan(body);
  const existed = !!(await agencySubscriptionPlanModel.get());
  const plan = await agencySubscriptionPlanModel.upsert(clean);
  await auditLogModel.create({
    tenantId: null,
    userId: actorUserId,
    action: existed ? "agency_plan.updated" : "agency_plan.created",
    entityType: "agency_subscription_plan",
    entityId: plan.id,
    meta: { price: plan.price, currency: plan.currency, isActive: plan.is_active },
  });
  return plan;
}

// Used by billingService.initiateAgencySubscription before ever calling
// Razorpay — mirrors subscriptionPlanService.requireActivePlan's guard,
// plus an explicit check that Super Admin has actually linked a Razorpay
// Plan yet (a price alone isn't enough to create a real subscription).
async function requireActivePlan() {
  const plan = await agencySubscriptionPlanModel.get();
  if (!plan || !plan.is_active) {
    throw httpError("Agency signup is not currently available. Please contact the platform administrator.", 503, "AGENCY_PLAN_NOT_AVAILABLE");
  }
  if (!plan.razorpay_plan_id) {
    throw httpError("Agency signup is not currently available. Please contact the platform administrator.", 503, "AGENCY_PLAN_NOT_CONFIGURED");
  }
  return plan;
}

module.exports = { get, getPublic, upsert, requireActivePlan };
