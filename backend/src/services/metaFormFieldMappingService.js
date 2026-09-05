const metaFormFieldMappingModel = require("../models/metaFormFieldMappingModel");
const customFieldModel = require("../models/customFieldModel");
const httpError = require("../utils/httpError");
const { isNonEmptyString } = require("../validators/primitives");

const CORE_FIELD_KEYS = new Set(["name", "phone", "email"]);

/**
 * §F: "If a field requires a custom definition but no valid client field
 * definition exists, handle it according to the existing validation
 * behavior instead of silently inventing a field." A mapping's
 * crm_field_key must resolve to either a fixed core key or one of the
 * client's own active custom field definitions — checked here at
 * mapping-save time, not just hoped for at ingestion time.
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
  if (!isNonEmptyString(body?.metaFormId, 64)) throw httpError("metaFormId is required.", 400);
  if (!isNonEmptyString(body?.metaFieldKey, 255)) throw httpError("metaFieldKey is required.", 400);
  if (!isNonEmptyString(body?.crmFieldKey, 100)) throw httpError("crmFieldKey is required.", 400);
  return {
    metaFormId: body.metaFormId.trim(),
    metaFieldKey: body.metaFieldKey.trim(),
    crmFieldKey: body.crmFieldKey.trim(),
  };
}

async function list(clientId, metaFormId) {
  return metaFormFieldMappingModel.listForClient(clientId, metaFormId);
}

async function create(clientId, body) {
  const clean = validateMappingInput(body);
  await assertValidCrmFieldKey(clientId, clean.crmFieldKey);
  try {
    return await metaFormFieldMappingModel.create(clientId, clean);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw httpError("This Meta field is already mapped for this form.", 409, "MAPPING_EXISTS");
    }
    throw err;
  }
}

async function update(clientId, id, body) {
  if (!isNonEmptyString(body?.crmFieldKey, 100)) throw httpError("crmFieldKey is required.", 400);
  const crmFieldKey = body.crmFieldKey.trim();
  await assertValidCrmFieldKey(clientId, crmFieldKey);
  const updated = await metaFormFieldMappingModel.update(clientId, id, { crmFieldKey });
  if (!updated) throw httpError("Mapping not found.", 404);
  return updated;
}

async function remove(clientId, id) {
  const removed = await metaFormFieldMappingModel.remove(clientId, id);
  if (!removed) throw httpError("Mapping not found.", 404);
}

module.exports = { list, create, update, remove, CORE_FIELD_KEYS };
