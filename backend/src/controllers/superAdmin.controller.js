const superAdminService = require("../services/superAdminService");
const clientLicensePriceService = require("../services/clientLicensePriceService");
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

module.exports = {
  listTenants,
  getTenant,
  createAgency,
  inviteAgencyAdmin,
  updateStatus,
  overview,
  getClientLicensePrice,
  upsertClientLicensePrice,
};
