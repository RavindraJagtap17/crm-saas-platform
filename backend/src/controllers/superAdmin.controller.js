const superAdminService = require("../services/superAdminService");
const subscriptionPlanService = require("../services/subscriptionPlanService");
const billingService = require("../services/billingService");
const asyncHandler = require("../utils/asyncHandler");

const listTenants = asyncHandler(async (req, res) => {
  res.json({ tenants: await superAdminService.listTenants() });
});

const getTenant = asyncHandler(async (req, res) => {
  res.json(await superAdminService.getTenant(req.params.id));
});

const updateEmployeeLimit = asyncHandler(async (req, res) => {
  const tenant = await superAdminService.updateEmployeeLimit(req.params.id, req.body, req.user.sub);
  res.json({ tenant });
});

const updateStatus = asyncHandler(async (req, res) => {
  const tenant = await superAdminService.updateStatus(req.params.id, req.body, req.user.sub);
  res.json({ tenant });
});

const overview = asyncHandler(async (req, res) => {
  res.json(await superAdminService.platformOverview());
});

// ---- Step 9: local plan catalog management (§B/§P) ----

const listPlans = asyncHandler(async (req, res) => {
  res.json({ plans: await subscriptionPlanService.listAll() });
});

const createPlan = asyncHandler(async (req, res) => {
  const plan = await subscriptionPlanService.create(req.body, req.user.sub);
  res.status(201).json({ plan });
});

const updatePlan = asyncHandler(async (req, res) => {
  const plan = await subscriptionPlanService.update(req.params.id, req.body, req.user.sub);
  res.json({ plan });
});

const setPlanActive = asyncHandler(async (req, res) => {
  const plan = await subscriptionPlanService.setActive(req.params.id, req.body?.isActive, req.user.sub);
  res.json({ plan });
});

// ---- Step 9: any-tenant subscription override (§K) — reuses the exact
// same billingService functions the Tenant Admin's own routes call;
// authorization (any tenant vs. own tenant only) is the only difference,
// and it lives entirely in which tenantId this route passes in
// (req.params.id here, vs. req.tenantId on the tenant-facing routes). ----

const getTenantSubscription = asyncHandler(async (req, res) => {
  res.json(await billingService.getSubscriptionForTenant(req.params.id));
});

const changeTenantPlan = asyncHandler(async (req, res) => {
  res.json(await billingService.changePlan(req.params.id, req.body, { userId: req.user.sub }));
});

const suspendTenantSubscription = asyncHandler(async (req, res) => {
  res.json({ tenant: await billingService.suspend(req.params.id, { userId: req.user.sub }) });
});

const resumeTenantSubscription = asyncHandler(async (req, res) => {
  res.json({ tenant: await billingService.resume(req.params.id, { userId: req.user.sub }) });
});

const cancelTenantSubscription = asyncHandler(async (req, res) => {
  res.json({ tenant: await billingService.cancel(req.params.id, { userId: req.user.sub }) });
});

module.exports = {
  listTenants,
  getTenant,
  updateEmployeeLimit,
  updateStatus,
  overview,
  listPlans,
  createPlan,
  updatePlan,
  setPlanActive,
  getTenantSubscription,
  changeTenantPlan,
  suspendTenantSubscription,
  resumeTenantSubscription,
  cancelTenantSubscription,
};
