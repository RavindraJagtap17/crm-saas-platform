const tenantModel = require("../models/tenantModel");
const httpError = require("../utils/httpError");
const { validateUpdateBranding } = require("../validators/tenantValidators");

// What a Tenant Admin/Employee is allowed to see about their own tenant —
// no subdomain/custom_domain exposure needed yet (reserved, unimplemented
// per §G), and never another tenant's data (tenantId always comes from
// the caller's own verified token).
function serializePublic(tenant) {
  if (!tenant) return null;
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    employeeLimit: tenant.employee_limit,
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
