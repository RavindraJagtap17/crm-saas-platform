const tenantModel = require("../models/tenantModel");
const httpError = require("../utils/httpError");
const { validateUpdateBranding } = require("../validators/tenantValidators");
const { assertValidImage } = require("../utils/imageSignature");
const { saveTenantImage, deleteTenantImage } = require("../utils/uploadStorage");

// What an Agency Admin is allowed to see about their own agency — branding
// is agency-only under the B2B2C model (no Client Admin/Employee reaches
// this service at all, see tenant.routes.js). No subdomain/custom_domain
// exposure needed yet (reserved, unimplemented per §G), and never another
// agency's data (tenantId always comes from the caller's own verified
// token).
function serializePublic(tenant) {
  if (!tenant) return null;
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    logoUrl: tenant.logo_url,
    faviconUrl: tenant.favicon_url,
    brandPrimaryColor: tenant.brand_primary_color,
  };
}

async function getOwnTenant(tenantId) {
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw httpError("Tenant not found.", 404);
  return serializePublic(tenant);
}

async function updateOwnBranding(tenantId, body) {
  const clean = validateUpdateBranding(body);
  const updated = await tenantModel.updateBranding(tenantId, clean);
  return serializePublic(updated);
}

// Logo/favicon upload — White-label Phase 1. tenantId comes only from
// req.tenantId (JWT-derived, see tenantScope.js), never from the request
// body/params, so there is no field an attacker could manipulate to write
// into another tenant's storage. The file's real content is validated
// against its actual bytes (assertValidImage), not the client-declared
// mimetype multer's fileFilter already checked — belt-and-suspenders
// against a renamed/spoofed upload.
async function uploadLogo(tenantId, file) {
  const { ext } = assertValidImage(file);
  const url = saveTenantImage(tenantId, "logo", ext, file.buffer);
  const updated = await tenantModel.setLogoUrl(tenantId, url);
  return serializePublic(updated);
}

async function uploadFavicon(tenantId, file) {
  const { ext } = assertValidImage(file);
  const url = saveTenantImage(tenantId, "favicon", ext, file.buffer);
  const updated = await tenantModel.setFaviconUrl(tenantId, url);
  return serializePublic(updated);
}

async function deleteLogo(tenantId) {
  deleteTenantImage(tenantId, "logo");
  const updated = await tenantModel.setLogoUrl(tenantId, null);
  return serializePublic(updated);
}

async function deleteFavicon(tenantId) {
  deleteTenantImage(tenantId, "favicon");
  const updated = await tenantModel.setFaviconUrl(tenantId, null);
  return serializePublic(updated);
}

module.exports = {
  getOwnTenant,
  updateOwnBranding,
  uploadLogo,
  uploadFavicon,
  deleteLogo,
  deleteFavicon,
  serializePublic,
};
