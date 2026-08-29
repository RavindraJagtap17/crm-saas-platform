const subscriptionPlanModel = require("../models/subscriptionPlanModel");
const auditLogModel = require("../models/auditLogModel");
const httpError = require("../utils/httpError");
const { validateCreatePlan, validateUpdatePlan } = require("../validators/billingValidators");

// Tenant-facing: only what a tenant may actually select (§B).
async function listActive() {
  return subscriptionPlanModel.listActive();
}

// Super Admin catalog management — every plan, active or not (§P).
async function listAll() {
  return subscriptionPlanModel.listAll();
}

async function create(body, actorUserId) {
  const clean = validateCreatePlan(body);
  const existing = await subscriptionPlanModel.findByRazorpayPlanId(clean.razorpayPlanId);
  if (existing) throw httpError("A local plan already references this Razorpay Plan ID.", 409, "PLAN_ALREADY_MAPPED");
  const plan = await subscriptionPlanModel.create(clean);
  await auditLogModel.create({
    tenantId: null,
    userId: actorUserId,
    action: "plan.created",
    entityType: "subscription_plan",
    entityId: plan.id,
    meta: { name: plan.name, razorpayPlanId: plan.razorpay_plan_id },
  });
  return plan;
}

async function update(id, body, actorUserId) {
  const clean = validateUpdatePlan(body);
  const updated = await subscriptionPlanModel.update(id, clean);
  if (!updated) throw httpError("Plan not found.", 404);
  await auditLogModel.create({
    tenantId: null,
    userId: actorUserId,
    action: "plan.updated",
    entityType: "subscription_plan",
    entityId: Number(id),
    meta: clean,
  });
  return updated;
}

// §B: deactivate/reactivate — never edits or deletes anything on
// Razorpay's side, and never touches an existing tenant's subscription;
// it only removes/restores this plan's availability to NEW subscribers.
async function setActive(id, isActive, actorUserId) {
  const updated = await subscriptionPlanModel.setActive(id, isActive);
  if (!updated) throw httpError("Plan not found.", 404);
  await auditLogModel.create({
    tenantId: null,
    userId: actorUserId,
    action: isActive ? "plan.activated" : "plan.deactivated",
    entityType: "subscription_plan",
    entityId: Number(id),
    meta: null,
  });
  return updated;
}

// Used by billingService before ever calling Razorpay — a tenant/admin
// can only ever act on a plan that is both real and currently active.
async function requireActivePlan(id) {
  const plan = await subscriptionPlanModel.findById(id);
  if (!plan || !plan.is_active) {
    throw httpError("This plan is not available.", 400, "PLAN_NOT_AVAILABLE");
  }
  return plan;
}

module.exports = { listActive, listAll, create, update, setActive, requireActivePlan };
