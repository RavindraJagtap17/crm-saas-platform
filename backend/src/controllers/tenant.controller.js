const tenantService = require("../services/tenantService");
const asyncHandler = require("../utils/asyncHandler");

const getOwn = asyncHandler(async (req, res) => {
  res.json({ tenant: await tenantService.getOwnTenant(req.tenantId) });
});

const updateOwn = asyncHandler(async (req, res) => {
  res.json({ tenant: await tenantService.updateOwnBranding(req.tenantId, req.body) });
});

const uploadLogo = asyncHandler(async (req, res) => {
  res.json({ tenant: await tenantService.uploadLogo(req.tenantId, req.file) });
});

const uploadFavicon = asyncHandler(async (req, res) => {
  res.json({ tenant: await tenantService.uploadFavicon(req.tenantId, req.file) });
});

const deleteLogo = asyncHandler(async (req, res) => {
  res.json({ tenant: await tenantService.deleteLogo(req.tenantId) });
});

const deleteFavicon = asyncHandler(async (req, res) => {
  res.json({ tenant: await tenantService.deleteFavicon(req.tenantId) });
});

module.exports = { getOwn, updateOwn, uploadLogo, uploadFavicon, deleteLogo, deleteFavicon };
