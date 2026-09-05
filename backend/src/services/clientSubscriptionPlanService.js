const clientSubscriptionPlanModel = require("../models/clientSubscriptionPlanModel");
const auditLogModel = require("../models/auditLogModel");
const httpError = require("../utils/httpError");
const { validateCreateClientPlan, validateUpdateClientPlan } = require("../validators/clientSubscriptionPlanValidators");

function serialize(plan) {
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    billingCycle: plan.billing_cycle,
    maxActiveEmployees: plan.max_active_employees,
    isActive: !!plan.is_active,
    createdAt: plan.created_at,
    updatedAt: plan.updated_at,
  };
}

// Agency Admin's own management view — every plan for their agency,
// active or not (§10's "new Clients only see active plans" is a
// DIFFERENT, not-yet-built consumer — see clientSubscriptionPlanModel.
// listActiveByTenant). This is the only listing this step wires to a route.
async function listPlans(tenantId) {
  const plans = await clientSubscriptionPlanModel.listByTenant(tenantId);
  return plans.map(serialize);
}

async function getPlan(tenantId, planId) {
  const plan = await clientSubscriptionPlanModel.findById(tenantId, planId);
  if (!plan) throw httpError("Client plan not found.", 404);
  return serialize(plan);
}

async function createPlan(tenantId, body, actorUserId) {
  const clean = validateCreateClientPlan(body);
  const plan = await clientSubscriptionPlanModel.create(tenantId, clean);
  await auditLogModel.create({
    tenantId,
    userId: actorUserId,
    action: "client_plan.created",
    entityType: "client_subscription_plan",
    entityId: plan.id,
    meta: { name: plan.name, price: plan.price, billingCycle: plan.billing_cycle, maxActiveEmployees: plan.max_active_employees },
  });
  return serialize(plan);
}

async function updatePlan(tenantId, planId, body, actorUserId) {
  const clean = validateUpdateClientPlan(body);
  const updated = await clientSubscriptionPlanModel.update(tenantId, planId, clean);
  if (!updated) throw httpError("Client plan not found.", 404);
  await auditLogModel.create({
    tenantId,
    userId: actorUserId,
    action: "client_plan.updated",
    entityType: "client_subscription_plan",
    entityId: Number(planId),
    meta: clean,
  });
  return serialize(updated);
}

// §7: soft deactivation only. Idempotency guard (already-inactive ->
// 400) rather than a silent no-op, so an Agency Admin double-click or a
// stale UI state gets a clear signal instead of an ambiguous 200.
async function deactivatePlan(tenantId, planId, actorUserId) {
  const existing = await clientSubscriptionPlanModel.findById(tenantId, planId);
  if (!existing) throw httpError("Client plan not found.", 404);
  if (!existing.is_active) throw httpError("This plan is already inactive.", 400, "PLAN_ALREADY_INACTIVE");

  const updated = await clientSubscriptionPlanModel.setActive(tenantId, planId, false);
  await auditLogModel.create({
    tenantId,
    userId: actorUserId,
    action: "client_plan.deactivated",
    entityType: "client_subscription_plan",
    entityId: Number(planId),
    meta: null,
  });
  return serialize(updated);
}

module.exports = { listPlans, getPlan, createPlan, updatePlan, deactivatePlan, serialize };
