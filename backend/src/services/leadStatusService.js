const leadStatusModel = require("../models/leadStatusModel");
const httpError = require("../utils/httpError");
const { validateCreateStatus, validateUpdateStatus } = require("../validators/configValidators");

async function list(tenantId) {
  return leadStatusModel.list(tenantId);
}

async function create(tenantId, createdBy, body) {
  const clean = validateCreateStatus(body);
  return leadStatusModel.create(tenantId, { ...clean, createdBy });
}

async function update(tenantId, id, body) {
  const existing = await leadStatusModel.findById(tenantId, id);
  if (!existing) throw httpError("Lead status not found.", 404);
  const patch = validateUpdateStatus(body);
  return leadStatusModel.update(tenantId, id, patch);
}

// Used by leadService to confirm a status_id belongs to the caller's tenant.
async function requireBelongsToTenant(tenantId, id) {
  const status = await leadStatusModel.findById(tenantId, id);
  if (!status) throw httpError("status_id does not belong to your tenant.", 400);
  return status;
}

module.exports = { list, create, update, requireBelongsToTenant };
