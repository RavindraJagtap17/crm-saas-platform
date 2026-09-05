const clientSubscriptionPlanService = require("../services/clientSubscriptionPlanService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  res.json({ plans: await clientSubscriptionPlanService.listPlans(req.tenantId) });
});

const get = asyncHandler(async (req, res) => {
  res.json({ plan: await clientSubscriptionPlanService.getPlan(req.tenantId, req.params.id) });
});

const create = asyncHandler(async (req, res) => {
  const plan = await clientSubscriptionPlanService.createPlan(req.tenantId, req.body, req.user.sub);
  res.status(201).json({ plan });
});

const update = asyncHandler(async (req, res) => {
  const plan = await clientSubscriptionPlanService.updatePlan(req.tenantId, req.params.id, req.body, req.user.sub);
  res.json({ plan });
});

const deactivate = asyncHandler(async (req, res) => {
  const plan = await clientSubscriptionPlanService.deactivatePlan(req.tenantId, req.params.id, req.user.sub);
  res.json({ plan });
});

module.exports = { list, get, create, update, deactivate };
