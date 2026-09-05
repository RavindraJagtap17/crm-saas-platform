const superAdminService = require("../services/superAdminService");
const subscriptionPlanService = require("../services/subscriptionPlanService");
const billingService = require("../services/billingService");
const agencySubscriptionPlanService = require("../services/agencySubscriptionPlanService");
const asyncHandler = require("../utils/asyncHandler");

const listTenants = asyncHandler(async (req, res) => {
  res.json({ tenants: await superAdminService.listTenants() });
});

const getTenant = asyncHandler(async (req, res) => {
  res.json(await superAdminService.getTenant(req.params.id));
});

const createAgency = asyncHandler(async (req, res) => {
  const tenant = await superAdminService.createAgency(req.body, req.user.sub);
  res.status(201).json({ tenant });
});

const inviteAgencyAdmin = asyncHandler(async (req, res) => {
  const user = await superAdminService.inviteAgencyAdmin(req.params.id, req.body, req.user.sub);
  res.status(201).json({ user });
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

// ---- New business model: the ONE Agency plan (agency_subscription_plan,
// migration 041) — Super Admin sets/updates its price. Separate from the
// Step 9 multi-plan catalog above (/plans), left untouched. ----

const getAgencyPlan = asyncHandler(async (req, res) => {
  res.json({ plan: await agencySubscriptionPlanService.get() });
});

const upsertAgencyPlan = asyncHandler(async (req, res) => {
  const plan = await agencySubscriptionPlanService.upsert(req.body, req.user.sub);
  res.json({ plan });
});

// Read-only: one Agency's real current subscription under the new model —
// reuses billingService.getAgencySubscriptionForTenant exactly as the §K
// old-flow override above reuses billingService.getSubscriptionForTenant,
// just against the new table. No write actions here: the finalized
// business model gives Super Admin no manual suspend/resume/change-plan
// control over the new single-plan Agency subscription (unlike the old
// catalog's §K override) — recovery/cancellation is Agency-Admin
// self-service, and expiry is webhook/grace-period driven.
const getTenantAgencySubscription = asyncHandler(async (req, res) => {
  res.json(await billingService.getAgencySubscriptionForTenant(req.params.id));
});

module.exports = {
  listTenants,
  getTenant,
  createAgency,
  inviteAgencyAdmin,
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
  getAgencyPlan,
  upsertAgencyPlan,
  getTenantAgencySubscription,
};
