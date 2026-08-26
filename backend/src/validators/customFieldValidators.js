const httpError = require("../utils/httpError");
const { isNonEmptyString, isPlainObject } = require("./primitives");

// The only 5 types Phase 1 supports — deliberately an allowlist, not a
// denylist, so a file/document-upload type (or anything else) is
// impossible to request, not just discouraged.
const ALLOWED_FIELD_TYPES = ["text", "select", "number", "date", "textarea"];

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function validateCreateDefinition(body) {
  if (!isNonEmptyString(body?.fieldKey) || !FIELD_KEY_PATTERN.test(body.fieldKey)) {
    throw httpError(
      "fieldKey is required and must be lowercase letters, numbers, and underscores only (start with a letter, max 64 chars).",
      400
    );
  }
  if (!isNonEmptyString(body?.label, 255)) {
    throw httpError("label is required.", 400);
  }
  if (!ALLOWED_FIELD_TYPES.includes(body?.fieldType)) {
    throw httpError(`fieldType must be one of: ${ALLOWED_FIELD_TYPES.join(", ")}.`, 400);
  }

  let options;
  if (body.fieldType === "select") {
    if (!Array.isArray(body.options) || body.options.length === 0) {
      throw httpError("select fields require a non-empty options array of strings.", 400);
    }
    const cleaned = body.options.map((o) => String(o).trim()).filter(Boolean);
    if (cleaned.length !== body.options.length || new Set(cleaned).size !== cleaned.length) {
      throw httpError("options must be non-empty, unique strings.", 400);
    }
    options = cleaned;
  } else if (body.options !== undefined && body.options !== null) {
    throw httpError("options is only valid for fieldType = select.", 400);
  }

  return {
    fieldKey: body.fieldKey,
    label: body.label.trim(),
    fieldType: body.fieldType,
    options,
  };
}

function validateUpdateDefinition(body, existing) {
  const patch = {};
  if (body?.label !== undefined) {
    if (!isNonEmptyString(body.label, 255)) throw httpError("label must be a non-empty string.", 400);
    patch.label = body.label.trim();
  }
  if (body?.isActive !== undefined) {
    patch.isActive = !!body.isActive;
  }
  if (body?.options !== undefined) {
    if (existing.field_type !== "select") {
      throw httpError("options can only be changed for fieldType = select.", 400);
    }
    if (!Array.isArray(body.options) || body.options.length === 0) {
      throw httpError("options must be a non-empty array of strings.", 400);
    }
    patch.options = body.options.map((o) => String(o).trim()).filter(Boolean);
  }
  // fieldKey and fieldType are deliberately not editable — leads may
  // already store values keyed/typed against the original definition.
  if (body?.fieldKey !== undefined || body?.fieldType !== undefined) {
    throw httpError("fieldKey and fieldType cannot be changed after creation.", 400);
  }
  return patch;
}

/**
 * Validates a lead's incoming custom_fields object against the tenant's
 * currently-active field definitions (§G). Returns a cleaned object
 * containing only validated key/value pairs — never a passthrough of
 * whatever the client sent.
 */
function validateLeadCustomFields(customFields, activeDefinitions) {
  if (customFields === undefined) return undefined;
  if (!isPlainObject(customFields)) {
    throw httpError("customFields must be an object.", 400);
  }

  const byKey = new Map(activeDefinitions.map((d) => [d.field_key, d]));
  const cleaned = {};

  for (const [key, value] of Object.entries(customFields)) {
    const def = byKey.get(key);
    if (!def) {
      throw httpError(`Unknown custom field: ${key}`, 400);
    }
    cleaned[key] = validateValueForType(key, value, def);
  }

  return cleaned;
}

function validateValueForType(key, value, def) {
  switch (def.field_type) {
    case "text":
    case "textarea":
      if (typeof value !== "string" || value.length > 5000) {
        throw httpError(`Invalid value for custom field "${key}": expected text.`, 400);
      }
      return value;

    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (typeof value === "boolean" || value === "" || !Number.isFinite(n)) {
        throw httpError(`Invalid value for custom field "${key}": expected a number.`, 400);
      }
      return n;
    }

    case "date": {
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw httpError(`Invalid value for custom field "${key}": expected a valid date.`, 400);
      }
      return value;
    }

    case "select": {
      const options = Array.isArray(def.options) ? def.options : JSON.parse(def.options || "[]");
      if (typeof value !== "string" || !options.includes(value)) {
        throw httpError(`Invalid value for custom field "${key}": must be one of ${options.join(", ")}.`, 400);
      }
      return value;
    }

    default:
      // Unreachable given the ALLOWED_FIELD_TYPES allowlist at definition
      // creation time, but fail closed rather than silently accepting.
      throw httpError(`Custom field "${key}" has an unsupported type.`, 400);
  }
}

module.exports = {
  ALLOWED_FIELD_TYPES,
  validateCreateDefinition,
  validateUpdateDefinition,
  validateLeadCustomFields,
};
