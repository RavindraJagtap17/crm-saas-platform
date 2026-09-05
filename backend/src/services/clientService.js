const clientModel = require("../models/clientModel");
const agencySubscriptionModel = require("../models/agencySubscriptionModel");
const userModel = require("../models/userModel");
const roleModel = require("../models/roleModel");
const auditLogModel = require("../models/auditLogModel");
const customFieldModel = require("../models/customFieldModel");
const customFieldService = require("./customFieldService");
const leadSourceService = require("./leadSourceService");
const productService = require("./productService");
const httpError = require("../utils/httpError");
const { isNonEmptyString } = require("../validators/primitives");
const { validateStatus: validateClientStatusBody } = require("../validators/clientValidators");
const { validateInvite } = require("../validators/userValidators");

function serialize(client) {
  return {
    id: client.id,
    name: client.name,
    status: client.status,
    createdAt: client.created_at,
    updatedAt: client.updated_at,
  };
}

/**
 * The effective client limit is ALWAYS resolved live from the agency's
 * current subscription — never cached on tenants, never a static column.
 * Read fresh on every check, exactly like requireActiveTenant re-reads
 * status fresh on every request.
 *
 * FIX (final integration audit, CRITICAL finding): this previously read
 * subscriptionModel/subscriptionPlanModel — the pre-B2B2C-restructure
 * subscriptions/subscription_plans catalog (migrations 018/019). Migration
 * 041 replaced that per-plan-tier catalog with a single global
 * agency_subscription_plan (price/currency only, no per-plan client-limit
 * field — see that migration's own header comment: "reusing [the old
 * table] here would either force a fake 'catalog of one' or repurpose a
 * column with a different meaning"). No Agency created through the actual
 * signup flow (authService.signUpAgency + billingService's
 * agencySubscriptionModel-based activation) ever gets a row in the OLD
 * table, so this always evaluated to limit=0 — silently blocking Client
 * creation for every real Agency, regardless of subscription status.
 *
 * Corrected to read agency_subscriptions (the table the real flow
 * actually populates). Since the current single-global-plan model has no
 * numeric per-plan client cap at all, an Agency with a genuinely usable
 * subscription (active, or grace_period — same "still allowed until its
 * own deadline" treatment already used throughout this codebase, e.g.
 * requireActiveTenant's own agencyGracePeriodExpired) is unlimited;
 * anything else (no row, pending, cancelled, expired) keeps the existing
 * limit=0 "blocked" behavior — the same 0-vs-null contract create() and
 * the GET /clients/limit response already depend on, unchanged.
 */
async function effectiveClientLimit(tenantId) {
  const subscription = await agencySubscriptionModel.findByTenant(tenantId);
  if (!subscription) return 0;
  if (!["active", "grace_period"].includes(subscription.status)) return 0;
  return null; // no per-plan client limit exists in the current single-global-plan Agency model — unlimited once genuinely subscribed
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
  if (!isNonEmptyString(body?.name, 255)) throw httpError("name is required.", 400);
  const name = body.name.trim();

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

  const client = await clientModel.create(tenantId, { name });
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
