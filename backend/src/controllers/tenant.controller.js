const tenantService = require("../services/tenantService");
const asyncHandler = require("../utils/asyncHandler");

const getOwn = asyncHandler(async (req, res) => {
  res.json({ tenant: await tenantService.getOwnTenant(req.tenantId) });
});

const updateOwn = asyncHandler(async (req, res) => {
  res.json({ tenant: await tenantService.updateOwnBranding(req.tenantId, req.body) });
});

module.exports = { getOwn, updateOwn };
