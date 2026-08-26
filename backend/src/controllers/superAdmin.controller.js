const superAdminService = require("../services/superAdminService");
const asyncHandler = require("../utils/asyncHandler");

const listTenants = asyncHandler(async (req, res) => {
  res.json({ tenants: await superAdminService.listTenants() });
});

const getTenant = asyncHandler(async (req, res) => {
  res.json(await superAdminService.getTenant(req.params.id));
});

const updateEmployeeLimit = asyncHandler(async (req, res) => {
  const tenant = await superAdminService.updateEmployeeLimit(req.params.id, req.body);
  res.json({ tenant });
});

const updateStatus = asyncHandler(async (req, res) => {
  const tenant = await superAdminService.updateStatus(req.params.id, req.body);
  res.json({ tenant });
});

const overview = asyncHandler(async (req, res) => {
  res.json(await superAdminService.platformOverview());
});

module.exports = { listTenants, getTenant, updateEmployeeLimit, updateStatus, overview };
