const clientModel = require("../models/clientModel");
const userModel = require("../models/userModel");
const roleModel = require("../models/roleModel");
const auditLogModel = require("../models/auditLogModel");
const customFieldModel = require("../models/customFieldModel");
const customFieldService = require("./customFieldService");
const leadSourceService = require("./leadSourceService");
const productService = require("./productService");
const httpError = require("../utils/httpError");
const { validateStatus: validateClientStatusBody, validateCreateClient } = require("../validators/clientValidators");
const { validateInvite } = require("../validators/userValidators");

function serialize(client) {
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
    updatedAt: client.updated_at,
  };
}

/**
 * "Agency pays per Client" restructure: there is no Agency-level Client
 * COUNT limit at all any more (confirmed business rule, unchanged from
 * before this restructure — see the earlier UI/terminology audit). What
 * gates adding a client now is exclusively whether the Agency pays for
 * that specific Client's own License (clientLicenseService), never a cap
 * on how many Clients already exist. This function previously derived a
 * 0-vs-null limit from the Agency's own flat subscription
 * (agency_subscriptions) — that concept no longer exists (Agency signup
 * is free), so continuing to read it here would incorrectly block every
 * Client creation for every Agency the moment that table stops being
 * populated. Always null (unlimited) now; kept as a function (not
 * inlined/removed) only because create()'s own limit-check block and
 * GET /api/clients/limit's response shape both still depend on it —
 * removing that plumbing entirely is a candidate for the broader cleanup
 * pass that removes the rest of the old Agency-subscription system.
 */
async function effectiveClientLimit(tenantId) {
  return null;
}

async function list(tenantId) {
  const clients = await clientModel.listByTenant(tenantId);
  return clients.map(serialize);
}

async function get(tenantId, id) {
  const client = await clientModel.findById(tenantId, id);
  if (!client) throw httpError("Client not found.", 404);
  return serialize(client);
}

/**
 * Post-Phase-D ownership fix: custom field DEFINITIONS are client-scoped
 * DATA but are now MANAGED by Agency Admin, not Client Admin (Client
 * Admin keeps read-only access — see customField.routes.js). No data is
 * duplicated: this reads/writes the exact same customFieldModel/
 * customFieldService that Client Admin's read-only endpoint and every
 * lead's custom_fields column already use — only who may call the
 * write side changes. Every function re-validates the selected client
 * belongs to the caller's own agency via get() (throws 404 otherwise)
 * before touching anything, so an Agency Admin can never reach another
 * agency's client's fields regardless of what clientId is in the URL.
 */
async function listCustomFields(tenantId, clientId) {
  await get(tenantId, clientId);
  return customFieldModel.list(clientId, { includeInactive: true });
}

async function createCustomField(tenantId, clientId, body) {
  await get(tenantId, clientId);
  return customFieldService.create(clientId, body);
}

async function updateCustomField(tenantId, clientId, fieldId, body) {
  await get(tenantId, clientId);
  return customFieldService.update(clientId, fieldId, body);
}

/**
 * Read-only — lets Agency Admin see (never edit) a client's lead sources
 * and products while building that client's Website Form, which needs a
 * real, client-owned sourceId (required) and optionally a productId.
 * Creating/editing sources and products themselves stays exclusively
 * Client Admin's job (see leadSource.routes.js / product.routes.js).
 */
async function listLeadSources(tenantId, clientId) {
  await get(tenantId, clientId);
  return leadSourceService.list(clientId);
}

async function listProducts(tenantId, clientId) {
  await get(tenantId, clientId);
  return productService.list(clientId, false);
}

/**
 * §downgrade-over-limit behavior: an agency already over its (possibly
 * newly-lowered) limit keeps every existing client untouched — this is
 * the ONLY place the limit is enforced, and only against creating a NEW
 * one. limit === null means unlimited; limit === 0 means no subscription
 * at all (never allowed to create).
 */
async function create(tenantId, body) {
  const clean = validateCreateClient(body);

  const limit = await effectiveClientLimit(tenantId);
  if (limit !== null) {
    const currentCount = await clientModel.countByTenant(tenantId);
    if (currentCount >= limit) {
      throw httpError(
        `Client limit reached (${currentCount}/${limit}) for your current plan. Upgrade your plan to add more clients.`,
        409,
        "CLIENT_LIMIT_REACHED"
      );
    }
  }

  const client = await clientModel.create(tenantId, clean);
  return serialize(client);
}

async function setStatus(tenantId, id, body, actorUserId) {
  const status = validateClientStatusBody(body);
  const existing = await clientModel.findById(tenantId, id);
  if (!existing) throw httpError("Client not found.", 404);

  const updated = await clientModel.setStatus(tenantId, id, status);
  await auditLogModel.create({
    tenantId,
    userId: actorUserId,
    action: "client.status_changed",
    entityType: "client",
    entityId: Number(id),
    meta: { from: existing.status, to: status },
  });
  return serialize(updated);
}

/**
 * Second half of "Agency Admin invites the first Client Admin for a
 * client" — mirrors the Super-Admin-invites-Agency-Admin pattern one
 * level down (invite -> status:invited -> activate on first Google
 * sign-in), keyed on client_id instead of tenant_id.
 */
async function inviteClientAdmin(tenantId, clientId, body, actorUserId) {
  const client = await clientModel.findById(tenantId, clientId);
  if (!client) throw httpError("Client not found.", 404);

  const clean = validateInvite(body, ["client_admin"]);
  const existing = await userModel.findByEmail(clean.email);
  if (existing) {
    throw httpError("An account already exists for this email.", 409, "ACCOUNT_EXISTS");
  }

  const role = await roleModel.findByName("client_admin");
  const created = await userModel.createInvitedForClient(clientId, { email: clean.email, name: clean.name, roleId: role.id });

  await auditLogModel.create({
    tenantId,
    userId: actorUserId,
    action: "client_admin.invited",
    entityType: "user",
    entityId: created.id,
    meta: { clientId, email: created.email },
  });

  return { id: created.id, email: created.email, name: created.name, role: created.role_name, status: created.status };
}

module.exports = {
  list,
  get,
  create,
  setStatus,
  inviteClientAdmin,
  effectiveClientLimit,
  serialize,
  listCustomFields,
  createCustomField,
  updateCustomField,
  listLeadSources,
  listProducts,
};
