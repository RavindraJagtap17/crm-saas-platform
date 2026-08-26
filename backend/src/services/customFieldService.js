const customFieldModel = require("../models/customFieldModel");
const httpError = require("../utils/httpError");
const {
  validateCreateDefinition,
  validateUpdateDefinition,
  validateLeadCustomFields,
} = require("../validators/customFieldValidators");

async function list(tenantId) {
  return customFieldModel.list(tenantId, { includeInactive: true });
}

async function create(tenantId, body) {
  const clean = validateCreateDefinition(body);
  const existing = await customFieldModel.findByKey(tenantId, clean.fieldKey);
  if (existing) {
    throw httpError(`A custom field with key "${clean.fieldKey}" already exists for this tenant.`, 409);
  }
  return customFieldModel.create(tenantId, clean);
}

async function update(tenantId, id, body) {
  const existing = await customFieldModel.findById(tenantId, id);
  if (!existing) throw httpError("Custom field not found.", 404);
  const patch = validateUpdateDefinition(body, existing);
  return customFieldModel.update(tenantId, id, patch);
}

// Used by leadService when creating/updating a lead — always re-fetches
// the tenant's current active definitions rather than trusting a cached
// list, so a field deactivated a second ago is rejected immediately.
async function validateForLead(tenantId, customFields) {
  if (customFields === undefined) return undefined;
  const activeDefinitions = await customFieldModel.list(tenantId, { includeInactive: false });
  return validateLeadCustomFields(customFields, activeDefinitions);
}

module.exports = { list, create, update, validateForLead };
