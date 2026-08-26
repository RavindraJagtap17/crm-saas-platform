const tenantModel = require("../models/tenantModel");
const userModel = require("../models/userModel");
const httpError = require("../utils/httpError");
const { validateStatus, validateEmployeeLimit } = require("../validators/tenantValidators");

// Full record — a Super Admin is allowed to see everything about a tenant,
// unlike the tenant's own members (tenantService.serializePublic).
function serialize(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    employeeLimit: tenant.employee_limit,
    logoUrl: tenant.logo_url,
    brandPrimaryColor: tenant.brand_primary_color,
    subdomain: tenant.subdomain,
    customDomain: tenant.custom_domain,
    createdAt: tenant.created_at,
    updatedAt: tenant.updated_at,
  };
}

async function listTenants() {
  const tenants = await tenantModel.listAll();
  return tenants.map(serialize);
}

async function getTenant(id) {
  const tenant = await tenantModel.findById(id);
  if (!tenant) throw httpError("Tenant not found.", 404);
  const users = await userModel.listByTenant(id);
  const employeeSeatsUsed = await userModel.countEmployeeSeatsUsed(id);
  return {
    tenant: serialize(tenant),
    employeeSeatsUsed,
    users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role_name, status: u.status })),
  };
}

async function updateEmployeeLimit(id, body) {
  const employeeLimit = validateEmployeeLimit(body);
  const updated = await tenantModel.updateEmployeeLimit(id, employeeLimit);
  if (!updated) throw httpError("Tenant not found.", 404);
  return serialize(updated);
}

// This is the "suspend/cancel subscription" capability the spec asks for,
// implemented against the one piece of subscription-adjacent state that
// actually exists today — tenants.status. There is no subscriptions table
// or Razorpay integration yet (later step), so there is nothing beyond
// this to suspend/cancel against right now.
async function updateStatus(id, body) {
  const status = validateStatus(body);
  const updated = await tenantModel.updateStatus(id, status);
  if (!updated) throw httpError("Tenant not found.", 404);
  return serialize(updated);
}

async function platformOverview() {
  return tenantModel.platformCounts();
}

module.exports = { listTenants, getTenant, updateEmployeeLimit, updateStatus, platformOverview };
