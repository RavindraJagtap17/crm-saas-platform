const billingService = require("../services/billingService");
const subscriptionPlanService = require("../services/subscriptionPlanService");
const agencySubscriptionPlanService = require("../services/agencySubscriptionPlanService");
const userModel = require("../models/userModel");
const asyncHandler = require("../utils/asyncHandler");

// GET /api/billing/plans — every ACTIVE local plan a tenant may select.
// Deliberately not gated by requireActiveTenant: a pending_payment tenant
// must be able to see what it can subscribe to.
const listPlans = asyncHandler(async (req, res) => {
  res.json({ plans: await subscriptionPlanService.listActive() });
});

const getSubscription = asyncHandler(async (req, res) => {
  res.json(await billingService.getSubscriptionForTenant(req.tenantId));
});

const listPayments = asyncHandler(async (req, res) => {
  res.json({ payments: await billingService.listPaymentsForTenant(req.tenantId) });
});

// POST /api/billing/subscribe — §C/§D: the signup-time (or first-time)
// checkout-initiation call. actorUser's name/email come from the users
// table, not the access token (which deliberately carries only
// sub/role/tenantId — see utils/jwt.js), since Razorpay's Customer record
// needs a real name/email to create or match against.
const subscribe = asyncHandler(async (req, res) => {
  const actorUser = await userModel.findById(req.user.sub);
  const result = await billingService.subscribe(req.tenantId, actorUser, req.body);
  res.status(201).json(result);
});

// PATCH /api/billing/subscription/plan — §J: Tenant Admin, own tenant only
// (req.tenantId comes from the verified token, never from request input).
const changePlan = asyncHandler(async (req, res) => {
  res.json(await billingService.changePlan(req.tenantId, req.body));
});

// ---- New business model: single-plan self-service Agency subscription ----

// GET /api/billing/agency-plan — PUBLIC (see billing.routes.js), so the
// self-service signup page can show a price before an account exists.
const getAgencyPlanPublic = asyncHandler(async (req, res) => {
  res.json({ plan: await agencySubscriptionPlanService.getPublic() });
});

const initiateAgencySubscription = asyncHandler(async (req, res) => {
  const actorUser = await userModel.findById(req.user.sub);
  const result = await billingService.initiateAgencySubscription(req.tenantId, actorUser);
  res.status(201).json(result);
});

const getAgencySubscription = asyncHandler(async (req, res) => {
  res.json(await billingService.getAgencySubscriptionForTenant(req.tenantId));
});

const cancelAgencySubscription = asyncHandler(async (req, res) => {
  res.json({ subscription: await billingService.cancelAgencySubscription(req.tenantId) });
});

module.exports = {
  listPlans,
  getSubscription,
  listPayments,
  subscribe,
  changePlan,
  getAgencyPlanPublic,
  initiateAgencySubscription,
  getAgencySubscription,
  cancelAgencySubscription,
};
