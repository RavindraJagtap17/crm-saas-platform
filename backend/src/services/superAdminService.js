const pool = require("../config/db");
const tenantModel = require("../models/tenantModel");
const clientModel = require("../models/clientModel");
const userModel = require("../models/userModel");
const roleModel = require("../models/roleModel");
const auditLogModel = require("../models/auditLogModel");
const httpError = require("../utils/httpError");
const { validateStatus, validateCreateAgency } = require("../validators/tenantValidators");
const { validateInvite } = require("../validators/userValidators");

// Full record — a Super Admin is allowed to see everything about a tenant,
// unlike the tenant's own members (tenantService.serializePublic).
// employee_limit deliberately omitted (see tenantModel.js) — it has no
// business meaning under the B2B2C model.
function serialize(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
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
  const agencyUsers = await userModel.listByTenant(id); // agency_admin roster only — see userModel.listByTenant
  const clients = await clientModel.listByTenant(id);
  return {
    tenant: serialize(tenant),
    clientCount: clients.length,
    clients,
    users: agencyUsers.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role_name, status: u.status })),
  };
}

/**
 * B2B2C restructure — first half of "Super Admin creates/identifies the
 * agency, then invites the first Agency Admin" (Business Decision 4).
 * Creates only the tenant row; the first Agency Admin is a separate,
 * explicit invite (inviteAgencyAdmin below), never bundled automatically —
 * an agency with no admin yet is a valid, expected intermediate state.
 */
async function createAgency(body, actorUserId) {
  const { name } = validateCreateAgency(body);

  const conn = await pool.getConnection();
  let tenantId;
  try {
    await conn.beginTransaction();
    const slug = await tenantModel.generateUniqueSlug(conn, name);
    tenantId = await tenantModel.createTenant(conn, { name, slug });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const tenant = await tenantModel.findById(tenantId);
  await auditLogModel.create({
    tenantId,
    userId: actorUserId,
    action: "agency.created",
    entityType: "tenant",
    entityId: tenantId,
    meta: { name: tenant.name, slug: tenant.slug },
  });
  return serialize(tenant);
}

/**
 * Second half of the provisioning flow — mirrors the pre-existing
 * invite->status:invited->activate-on-first-Google-signin pattern
 * unchanged, just one level up (agency_admin instead of tenant_admin).
 */
async function inviteAgencyAdmin(id, body, actorUserId) {
  const tenant = await tenantModel.findById(id);
  if (!tenant) throw httpError("Agency not found.", 404);

  const clean = validateInvite(body, ["agency_admin"]);
  const existing = await userModel.findByEmail(clean.email);
  if (existing) {
    throw httpError("An account already exists for this email.", 409, "ACCOUNT_EXISTS");
  }

  const role = await roleModel.findByName("agency_admin");
  const created = await userModel.createInvited(id, { email: clean.email, name: clean.name, roleId: role.id });

  await auditLogModel.create({
    tenantId: id,
    userId: actorUserId,
    action: "agency_admin.invited",
    entityType: "user",
    entityId: created.id,
    meta: { email: created.email },
  });

  return { id: created.id, email: created.email, name: created.name, role: created.role_name, status: created.status };
}

// This is the "suspend/cancel subscription" capability the spec asks for,
// implemented against the one piece of subscription-adjacent state that
// actually exists today — tenants.status. There is no subscriptions table
// or Razorpay integration yet (later step), so there is nothing beyond
// this to suspend/cancel against right now.
async function updateStatus(id, body, actorUserId) {
  const status = validateStatus(body);
  const existing = await tenantModel.findById(id);
  if (!existing) throw httpError("Tenant not found.", 404);
  const updated = await tenantModel.updateStatus(id, status);
  if (!updated) throw httpError("Tenant not found.", 404);
  await auditLogModel.create({
    tenantId: id,
    userId: actorUserId,
    action: "tenant.status_changed",
    entityType: "tenant",
    entityId: Number(id),
    meta: { from: existing.status, to: status },
  });
  return serialize(updated);
}

async function platformOverview() {
  return tenantModel.platformCounts();
}

module.exports = { listTenants, getTenant, createAgency, inviteAgencyAdmin, updateStatus, platformOverview };
