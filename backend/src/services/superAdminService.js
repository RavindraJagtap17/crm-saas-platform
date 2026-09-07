const pool = require("../config/db");
const tenantModel = require("../models/tenantModel");
const clientModel = require("../models/clientModel");
const clientLicenseModel = require("../models/clientLicenseModel");
const clientLicenseService = require("../services/clientLicenseService");
const userModel = require("../models/userModel");
const roleModel = require("../models/roleModel");
const auditLogModel = require("../models/auditLogModel");
const httpError = require("../utils/httpError");
const { validateStatus, validateStatusFilter, validateCreateAgency } = require("../validators/tenantValidators");
const { validateInvite } = require("../validators/userValidators");

// Full record — a Super Admin is allowed to see everything about a tenant,
// unlike the tenant's own members (tenantService.serializePublic).
// employee_limit deliberately omitted (see tenantModel.js) — it has no
// business meaning under the B2B2C model. address/city/gstNumber/mobile/
// contactEmail (migration 052) were already selected by tenantModel's own
// PUBLIC_COLUMNS but never mapped into this response — Super Admin audit
// finding, fixed here: no new query, the data was already being fetched.
function serialize(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    address: tenant.address,
    city: tenant.city,
    gstNumber: tenant.gst_number,
    mobile: tenant.mobile,
    contactEmail: tenant.contact_email,
    logoUrl: tenant.logo_url,
    brandPrimaryColor: tenant.brand_primary_color,
    subdomain: tenant.subdomain,
    customDomain: tenant.custom_domain,
    createdAt: tenant.created_at,
    updatedAt: tenant.updated_at,
  };
}

// Shared by getTenant's client table and getClient's own detail response
// — one serialization shape, license fields included. `license` is
// whatever clientLicenseModel.findByClient (or a pre-fetched Map lookup)
// returned, possibly null; clientLicenseService.normalizedStatus already
// treats null the same as "never purchased".
function serializeClient(client, license) {
  return {
    id: client.id,
    name: client.name,
    status: client.status,
    address: client.address,
    city: client.city,
    gstNumber: client.gst_number,
    mobile: client.mobile,
    contactEmail: client.contact_email,
    createdAt: client.created_at,
    license: {
      status: clientLicenseService.normalizedStatus(license),
      expiresAt: license?.current_period_end ?? null,
      daysRemaining: clientLicenseService.daysRemaining(license),
      // Current-cycle Razorpay references only (§8) — not a payment
      // history; client_licenses has no ledger, just these two ids for
      // whatever the CURRENT order/payment is. Neither is a secret (same
      // fields already exposed to the Agency Admin via GET /api/clients/
      // :id/license) — safe to surface as-is.
      razorpayOrderId: license?.razorpay_order_id ?? null,
      razorpayPaymentId: license?.razorpay_payment_id ?? null,
    },
  };
}

async function listTenants(query = {}) {
  const status = validateStatusFilter(query.status);
  const q = typeof query.q === "string" && query.q.trim() ? query.q.trim().slice(0, 255) : undefined;
  const tenants = await tenantModel.listAll({ q, status });
  return tenants.map(serialize);
}

async function getTenant(id) {
  const tenant = await tenantModel.findById(id);
  if (!tenant) throw httpError("Tenant not found.", 404);
  const agencyUsers = await userModel.listByTenant(id); // agency_admin roster only — see userModel.listByTenant
  const clients = await clientModel.listByTenant(id);

  // One batched license lookup for every client on the page (§5), not
  // N+1 — see clientLicenseModel.listByClientIds' own comment.
  const licenses = await clientLicenseModel.listByClientIds(clients.map((c) => c.id));
  const licenseByClientId = new Map(licenses.map((l) => [l.client_id, l]));

  return {
    tenant: serialize(tenant),
    clientCount: clients.length,
    clients: clients.map((c) => serializeClient(c, licenseByClientId.get(c.id) || null)),
    users: agencyUsers.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role_name, status: u.status })),
  };
}

/**
 * Super Admin Client detail (§3) — clientModel.findById(tenantId, clientId)
 * is the SAME composite (id, tenant_id) lookup every other tenant-owned
 * resource in this codebase already uses for ownership verification (see
 * e.g. clientModel.findById's own comment): a client id that belongs to a
 * DIFFERENT tenant simply doesn't match the WHERE clause and comes back
 * null, indistinguishable from a nonexistent client. This is what makes
 * "Client under the wrong Agency" 404 rather than something that needs a
 * separate ownership check bolted on afterward.
 */
async function getClient(tenantId, clientId) {
  const [tenant, client] = await Promise.all([tenantModel.findById(tenantId), clientModel.findById(tenantId, clientId)]);
  if (!tenant) throw httpError("Agency not found.", 404);
  if (!client) throw httpError("Client not found.", 404);

  const [license, roster] = await Promise.all([clientLicenseModel.findByClient(clientId), userModel.listByClient(clientId)]);

  const admins = roster.filter((u) => u.role_name === "client_admin").map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status }));
  const employeeCount = roster.filter((u) => u.role_name === "client_employee").length;

  return {
    ...serializeClient(client, license),
    tenantId: tenant.id,
    tenantName: tenant.name,
    admins,
    employeeCount,
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

/**
 * Platform dashboard (§6). Client license buckets are derived by running
 * every client's license row through clientLicenseService.normalizedStatus
 * — the exact same function the Client detail page uses — never a second,
 * SQL-side re-implementation of the expiry/status rule. This does mean
 * pulling one lightweight (client_id, status, current_period_end) row per
 * Client into memory once per dashboard load rather than expressing the
 * buckets as a single grouped SQL query; that trade favors "one place
 * defines what EXPIRING_SOON/EXPIRED/PENDING mean" over a marginal query
 * saving, and stays cheap since only three columns are selected.
 */
async function platformOverview() {
  const [counts, licenseRows, recent] = await Promise.all([
    tenantModel.platformCounts(),
    clientLicenseModel.listAllForDashboard(),
    tenantModel.listRecent(5),
  ]);

  const licenseBuckets = { ACTIVE: 0, EXPIRING_SOON: 0, EXPIRED: 0, PENDING: 0 };
  for (const row of licenseRows) {
    licenseBuckets[clientLicenseService.normalizedStatus(row)] += 1;
  }

  return {
    ...counts,
    clientLicenses: {
      active: licenseBuckets.ACTIVE,
      expiringSoon: licenseBuckets.EXPIRING_SOON,
      expired: licenseBuckets.EXPIRED,
      pending: licenseBuckets.PENDING,
    },
    recentAgencies: recent.map(serialize),
  };
}

module.exports = { listTenants, getTenant, getClient, createAgency, inviteAgencyAdmin, updateStatus, platformOverview };
