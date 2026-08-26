const webFormModel = require("../models/webFormModel");
const leadSourceService = require("./leadSourceService");
const productService = require("./productService");
const httpError = require("../utils/httpError");
const { validateCreateForm, validateUpdateForm } = require("../validators/webFormValidators");

function serialize(form) {
  return {
    id: form.id,
    name: form.name,
    formKey: form.form_key,
    sourceId: form.source_id,
    productId: form.product_id,
    allowedDomains: Array.isArray(form.allowed_domains) ? form.allowed_domains : JSON.parse(form.allowed_domains || "[]"),
    isActive: !!form.is_active,
    createdAt: form.created_at,
    updatedAt: form.updated_at,
  };
}

async function list(tenantId) {
  const forms = await webFormModel.listByTenant(tenantId);
  return forms.map(serialize);
}

async function create(tenantId, body) {
  const clean = validateCreateForm(body);
  await leadSourceService.requireBelongsToTenant(tenantId, clean.sourceId);
  if (clean.productId) await productService.requireBelongsToTenant(tenantId, clean.productId);

  const form = await webFormModel.create(tenantId, clean);
  return serialize(form);
}

async function update(tenantId, id, body) {
  const existing = await webFormModel.findById(tenantId, id);
  if (!existing) throw httpError("Form not found.", 404);

  const clean = validateUpdateForm(body);
  if (clean.sourceId) await leadSourceService.requireBelongsToTenant(tenantId, clean.sourceId);
  if (clean.productId) await productService.requireBelongsToTenant(tenantId, clean.productId);

  const updated = await webFormModel.update(tenantId, id, clean);
  return serialize(updated);
}

module.exports = { list, create, update, serialize };
