const leadStatusModel = require("../models/leadStatusModel");
const httpError = require("../utils/httpError");
const { validateCreateStatus, validateUpdateStatus } = require("../validators/configValidators");

async function list(clientId) {
  return leadStatusModel.list(clientId);
}

async function create(clientId, createdBy, body) {
  const clean = validateCreateStatus(body);
  return leadStatusModel.create(clientId, { ...clean, createdBy });
}

async function update(clientId, id, body) {
  const existing = await leadStatusModel.findById(clientId, id);
  if (!existing) throw httpError("Lead status not found.", 404);
  const patch = validateUpdateStatus(body);
  return leadStatusModel.update(clientId, id, patch);
}

// Used by leadService to confirm a status_id belongs to the caller's client.
async function requireBelongsToClient(clientId, id) {
  const status = await leadStatusModel.findById(clientId, id);
  if (!status) throw httpError("status_id does not belong to your client.", 400);
  return status;
}

module.exports = { list, create, update, requireBelongsToClient };
