const customFieldModel = require("../models/customFieldModel");
const httpError = require("../utils/httpError");
const {
  validateCreateDefinition,
  validateUpdateDefinition,
  validateLeadCustomFields,
} = require("../validators/customFieldValidators");

async function list(clientId) {
  return customFieldModel.list(clientId, { includeInactive: true });
}

async function create(clientId, body) {
  const clean = validateCreateDefinition(body);
  const existing = await customFieldModel.findByKey(clientId, clean.fieldKey);
  if (existing) {
    throw httpError(`A custom field with key "${clean.fieldKey}" already exists for this client.`, 409);
  }
  return customFieldModel.create(clientId, clean);
}

async function update(clientId, id, body) {
  const existing = await customFieldModel.findById(clientId, id);
  if (!existing) throw httpError("Custom field not found.", 404);
  const patch = validateUpdateDefinition(body, existing);
  return customFieldModel.update(clientId, id, patch);
}

// Used by leadService when creating/updating a lead — always re-fetches
// the client's current active definitions rather than trusting a cached
// list, so a field deactivated a second ago is rejected immediately.
async function validateForLead(clientId, customFields) {
  if (customFields === undefined) return undefined;
  const activeDefinitions = await customFieldModel.list(clientId, { includeInactive: false });
  return validateLeadCustomFields(customFields, activeDefinitions);
}

module.exports = { list, create, update, validateForLead };
