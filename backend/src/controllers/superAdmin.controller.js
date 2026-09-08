const superAdminService = require("../services/superAdminService");
const clientLicensePriceService = require("../services/clientLicensePriceService");
const integrationMonitoringService = require("../services/integrationMonitoringService");
const asyncHandler = require("../utils/asyncHandler");

const listTenants = asyncHandler(async (req, res) => {
  res.json({ tenants: await superAdminService.listTenants(req.query) });
});

const getTenant = asyncHandler(async (req, res) => {
  res.json(await superAdminService.getTenant(req.params.id));
});

const getClient = asyncHandler(async (req, res) => {
  res.json(await superAdminService.getClient(req.params.tenantId, req.params.clientId));
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

// ---- "Agency pays per Client" restructure: the ONE price an Agency pays
// per Client added (client_license_price, migration 055) — Super Admin
// sets/updates it. Replaces every prior Agency-billing concept this
// controller used to also expose (the Step-9 local plan catalog and its
// any-tenant subscription override, and the flat single-Agency-plan model
// that superseded it in turn) — all removed in this same restructure,
// since Agency signup is free now and there is nothing left to price or
// manage at the Agency level besides this. ----

const getClientLicensePrice = asyncHandler(async (req, res) => {
  res.json({ price: await clientLicensePriceService.get() });
});

const upsertClientLicensePrice = asyncHandler(async (req, res) => {
  const price = await clientLicensePriceService.upsert(req.body, req.user.sub);
  res.json({ price });
});

// ---- Platform-wide integration event monitoring ----
// Authorization is entirely the router's own requireRole("super_admin")
// gate (see superAdmin.routes.js) — everything in req.query below is
// search criteria only, never trusted to decide WHOSE data comes back
// (see integrationMonitoringValidators.js's own comment).
const listIntegrationEvents = asyncHandler(async (req, res) => {
  res.json(await integrationMonitoringService.listEvents(req.query));
});

const getIntegrationEvent = asyncHandler(async (req, res) => {
  res.json(await integrationMonitoringService.getEventDetail(req.params.id));
});

// Manual "Retry Now" — takes nothing from req.body at all; the event id
// (validated as a positive integer by validateIdParam) is the ONLY input
// from the browser. Everything else (provider, client, eligibility) is
// resolved server-side from the persisted event row itself.
const retryIntegrationEvent = asyncHandler(async (req, res) => {
  res.json(await integrationMonitoringService.retryEvent(req.params.id, req.user.sub));
});

// Read-only — who manually retried this event, when, and what happened.
// Reuses the SAME audit_logs rows retryIntegrationEvent above writes;
// req.query only ever supplies page/pageSize (see parsePagination).
const getIntegrationEventRetryHistory = asyncHandler(async (req, res) => {
  res.json(await integrationMonitoringService.getRetryHistory(req.params.id, req.query));
});

module.exports = {
  listTenants,
  getTenant,
  getClient,
  createAgency,
  inviteAgencyAdmin,
  updateStatus,
  overview,
  getClientLicensePrice,
  upsertClientLicensePrice,
  listIntegrationEvents,
  getIntegrationEvent,
  retryIntegrationEvent,
  getIntegrationEventRetryHistory,
};
