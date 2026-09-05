const tenantModel = require("../models/tenantModel");
const httpError = require("../utils/httpError");
const { validateUpdateBranding } = require("../validators/tenantValidators");

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

module.exports = { getOwnTenant, updateOwnBranding, serializePublic };
