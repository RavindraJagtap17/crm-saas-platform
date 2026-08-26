const leadSourceModel = require("../models/leadSourceModel");
const httpError = require("../utils/httpError");
const { validateCreateSource, validateUpdateSource } = require("../validators/configValidators");

async function list(tenantId) {
  return leadSourceModel.list(tenantId);
}

async function create(tenantId, body) {
  const clean = validateCreateSource(body);
  return leadSourceModel.create(tenantId, clean);
}

async function update(tenantId, id, body) {
  const existing = await leadSourceModel.findById(tenantId, id);
  if (!existing) throw httpError("Lead source not found.", 404);
  const patch = validateUpdateSource(body);
  return leadSourceModel.update(tenantId, id, patch);
}

async function requireBelongsToTenant(tenantId, id) {
  const source = await leadSourceModel.findById(tenantId, id);
  if (!source) throw httpError("source_id does not belong to your tenant.", 400);
  return source;
}

module.exports = { list, create, update, requireBelongsToTenant };
