const integrationFieldMappingModel = require("../models/integrationFieldMappingModel");
const customFieldModel = require("../models/customFieldModel");
const httpError = require("../utils/httpError");
const { isNonEmptyString } = require("../validators/primitives");
const { validateProvider } = require("./integrationConnectionService");

const CORE_FIELD_KEYS = new Set(["name", "phone", "email"]);

/**
 * §8 of the design doc / metaFormFieldMappingService.assertValidCrmFieldKey's
 * exact same rule, one level more generic: a mapping's crm_field_key must
 * resolve to either a fixed core key or one of the CLIENT's own active
 * custom field definitions — checked at mapping-save time, not just
 * hoped for at ingestion time, and re-checked fresh (never cached) so a
 * field deactivated a moment ago is rejected immediately.
 */
async function assertValidCrmFieldKey(clientId, crmFieldKey) {
  if (CORE_FIELD_KEYS.has(crmFieldKey)) return;
  const defs = await customFieldModel.list(clientId, { includeInactive: false });
  if (!defs.some((d) => d.field_key === crmFieldKey)) {
    throw httpError(
      `"${crmFieldKey}" is not a core field (name/phone/email) or an active custom field for this client. Create the custom field first.`,
      400,
      "INVALID_CRM_FIELD_KEY"
    );
  }
}

function validateMappingInput(body) {
  if (!isNonEmptyString(body?.externalFormId, 255)) throw httpError("externalFormId is required.", 400);
  if (!isNonEmptyString(body?.externalFieldKey, 255)) throw httpError("externalFieldKey is required.", 400);
  if (!isNonEmptyString(body?.crmFieldKey, 100)) throw httpError("crmFieldKey is required.", 400);
  return {
    externalFormId: body.externalFormId.trim(),
    externalFieldKey: body.externalFieldKey.trim(),
    crmFieldKey: body.crmFieldKey.trim(),
  };
}

async function list(clientId, provider, externalFormId) {
  validateProvider(provider);
  return integrationFieldMappingModel.listForClient(clientId, provider, externalFormId);
}

async function create(clientId, provider, body) {
  validateProvider(provider);
  const clean = validateMappingInput(body);
  await assertValidCrmFieldKey(clientId, clean.crmFieldKey);
  try {
    return await integrationFieldMappingModel.create(clientId, provider, clean);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw httpError("This field is already mapped for this form.", 409, "MAPPING_EXISTS");
    }
    throw err;
  }
}

async function update(clientId, provider, id, body) {
  validateProvider(provider);
  if (!isNonEmptyString(body?.crmFieldKey, 100)) throw httpError("crmFieldKey is required.", 400);
  const crmFieldKey = body.crmFieldKey.trim();
  await assertValidCrmFieldKey(clientId, crmFieldKey);
  const updated = await integrationFieldMappingModel.update(clientId, id, { crmFieldKey });
  if (!updated) throw httpError("Mapping not found.", 404);
  return updated;
}

async function remove(clientId, provider, id) {
  validateProvider(provider);
  const removed = await integrationFieldMappingModel.remove(clientId, id);
  if (!removed) throw httpError("Mapping not found.", 404);
}

/**
 * Ingestion-time application — walks the provider's own raw field list
 * (already normalized by the adapter into `{ key, value }` pairs) through
 * this client+provider+form's mappings. Mirrors metaLeadService.
 * applyFieldMapping exactly: an unmapped field is dropped, not stored,
 * and reported back in `unmapped` for observability (§7 of this task) —
 * never rejects the whole lead over one unmapped field.
 */
function applyMapping(fields, mappingsByRawKey) {
  const coreFields = {};
  const customFields = {};
  const unmapped = [];

  (fields || []).forEach(({ key, value }) => {
    const crmKey = mappingsByRawKey.get(key);
    if (!crmKey) {
      unmapped.push(key);
      return;
    }
    if (CORE_FIELD_KEYS.has(crmKey)) coreFields[crmKey] = value;
    else customFields[crmKey] = value;
  });

  return { coreFields, customFields, unmapped };
}

async function mapForForm(clientId, provider, externalFormId) {
  return integrationFieldMappingModel.mapForForm(clientId, provider, externalFormId);
}

module.exports = { list, create, update, remove, mapForForm, applyMapping, CORE_FIELD_KEYS };
