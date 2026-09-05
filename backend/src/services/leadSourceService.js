const leadSourceModel = require("../models/leadSourceModel");
const httpError = require("../utils/httpError");
const { validateCreateSource, validateUpdateSource } = require("../validators/configValidators");

async function list(clientId) {
  return leadSourceModel.list(clientId);
}

async function create(clientId, body) {
  const clean = validateCreateSource(body);
  return leadSourceModel.create(clientId, clean);
}

async function update(clientId, id, body) {
  const existing = await leadSourceModel.findById(clientId, id);
  if (!existing) throw httpError("Lead source not found.", 404);
  const patch = validateUpdateSource(body);
  return leadSourceModel.update(clientId, id, patch);
}

async function requireBelongsToClient(clientId, id) {
  const source = await leadSourceModel.findById(clientId, id);
  if (!source) throw httpError("source_id does not belong to your client.", 400);
  return source;
}

module.exports = { list, create, update, requireBelongsToClient };
