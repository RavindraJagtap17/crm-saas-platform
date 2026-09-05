const webFormModel = require("../models/webFormModel");
const clientModel = require("../models/clientModel");
const leadSourceService = require("./leadSourceService");
const productService = require("./productService");
const customFieldModel = require("../models/customFieldModel");
const httpError = require("../utils/httpError");
const { validateCreateForm, validateUpdateForm } = require("../validators/webFormValidators");

function serialize(form) {
  return {
    id: form.id,
    name: form.name,
    formKey: form.form_key,
    clientId: form.client_id,
    sourceId: form.source_id,
    productId: form.product_id,
    allowedDomains: Array.isArray(form.allowed_domains) ? form.allowed_domains : JSON.parse(form.allowed_domains || "[]"),
    isActive: !!form.is_active,
    createdAt: form.created_at,
    updatedAt: form.updated_at,
  };
}

// Dual-scoped (Category C): every write is authorized against tenantId
// (the caller's own agency, from the token) but source/product/custom
// fields — all client-owned resources — must be validated against the
// form's clientId, not the tenant. requireOwnClient is what bridges the
// two: a clientId the request names must actually belong to this agency.
async function requireOwnClient(tenantId, clientId) {
  const client = await clientModel.findById(tenantId, clientId);
  if (!client) throw httpError("clientId does not belong to your agency.", 400);
  return client;
}

async function list(tenantId) {
  const forms = await webFormModel.listByTenant(tenantId);
  return forms.map(serialize);
}

async function create(tenantId, body) {
  const clean = validateCreateForm(body);
  await requireOwnClient(tenantId, clean.clientId);
  await leadSourceService.requireBelongsToClient(clean.clientId, clean.sourceId);
  if (clean.productId) await productService.requireBelongsToClient(clean.clientId, clean.productId);

  const form = await webFormModel.create(tenantId, clean);
  return serialize(form);
}

async function update(tenantId, id, body) {
  const existing = await webFormModel.findById(tenantId, id);
  if (!existing) throw httpError("Form not found.", 404);

  const clean = validateUpdateForm(body);
  // clientId is deliberately not re-pointable after creation (would
  // silently re-scope every source/product reference and any leads
  // already ingested through this form's formKey) — not asked for by the
  // spec, and a genuinely different feature if it were needed later.
  if (clean.sourceId) await leadSourceService.requireBelongsToClient(existing.client_id, clean.sourceId);
  if (clean.productId) await productService.requireBelongsToClient(existing.client_id, clean.productId);

  const updated = await webFormModel.update(tenantId, id, clean);
  return serialize(updated);
}

/**
 * Lets an Agency Admin READ (never create/edit/delete — that stays the
 * Client Admin's job) a client's active custom field definitions while
 * building a form, so the field-mapping/config UI can offer them as
 * options. requireOwnClient is the only authorization check — this is a
 * read of another role's configuration, deliberately narrow.
 */
async function listClientCustomFieldsForForm(tenantId, clientId) {
  await requireOwnClient(tenantId, clientId);
  return customFieldModel.list(clientId, { includeInactive: false });
}

module.exports = { list, create, update, serialize, listClientCustomFieldsForForm };
