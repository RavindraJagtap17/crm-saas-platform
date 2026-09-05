const httpError = require("../utils/httpError");
const { isNonEmptyString, isOptionalString, isLikelyEmail, isOptionalPositiveInt, isPositiveInt } = require("./primitives");

// Fields a client is never allowed to set directly — they're computed by
// the server (duplicate detection, timestamps) or only ever change
// through their own dedicated, side-effect-creating endpoint (status,
// assignment). Silently stripped from every incoming body before anything
// else touches it.
const PROTECTED_FIELDS = [
  "id",
  "tenantId",
  "tenant_id",
  "clientId",
  "client_id",
  "isDuplicate",
  "is_duplicate",
  "duplicateOfLeadId",
  "duplicate_of_lead_id",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "statusId",
  "status_id",
  "assignedTo",
  "assigned_to",
  "metaLeadId",
  "meta_lead_id",
  "convertedAt",
  "converted_at",
];

function stripProtectedFields(body) {
  const clean = { ...(body || {}) };
  for (const field of PROTECTED_FIELDS) delete clean[field];
  return clean;
}

function validateCreateLead(body) {
  const clean = stripProtectedFields(body);

  if (clean.name !== undefined && !isOptionalString(clean.name, 255)) {
    throw httpError("name must be a string.", 400);
  }
  if (clean.phone !== undefined && !isOptionalString(clean.phone, 32)) {
    throw httpError("phone must be a string.", 400);
  }
  if (clean.email !== undefined && clean.email !== null && clean.email !== "" && !isLikelyEmail(clean.email)) {
    throw httpError("email is not a valid email address.", 400);
  }
  if (!isOptionalPositiveInt(clean.sourceId)) throw httpError("sourceId must be a positive integer.", 400);
  if (!isOptionalPositiveInt(clean.productId)) throw httpError("productId must be a positive integer.", 400);
  if (clean.customFields !== undefined && (typeof clean.customFields !== "object" || clean.customFields === null || Array.isArray(clean.customFields))) {
    throw httpError("customFields must be an object.", 400);
  }
  if (!clean.name && !clean.phone && !clean.email) {
    throw httpError("At least one of name, phone, or email is required.", 400);
  }

  return clean;
}

function validateUpdateLead(body) {
  const clean = stripProtectedFields(body);

  if (clean.name !== undefined && !isOptionalString(clean.name, 255)) {
    throw httpError("name must be a string.", 400);
  }
  if (clean.phone !== undefined && !isOptionalString(clean.phone, 32)) {
    throw httpError("phone must be a string.", 400);
  }
  if (clean.email !== undefined && clean.email !== null && clean.email !== "" && !isLikelyEmail(clean.email)) {
    throw httpError("email is not a valid email address.", 400);
  }
  if (!isOptionalPositiveInt(clean.sourceId)) throw httpError("sourceId must be a positive integer.", 400);
  if (!isOptionalPositiveInt(clean.productId)) throw httpError("productId must be a positive integer.", 400);
  if (clean.customFields !== undefined && (typeof clean.customFields !== "object" || clean.customFields === null || Array.isArray(clean.customFields))) {
    throw httpError("customFields must be an object.", 400);
  }

  return clean;
}

function validateStatusChange(body) {
  const statusId = body?.statusId ?? body?.status_id;
  if (!isPositiveInt(statusId)) throw httpError("statusId is required and must be a positive integer.", 400);
  return Number(statusId);
}

function validateAssignment(body) {
  const assignedTo = body?.assignedTo ?? body?.assigned_to;
  if (assignedTo !== null && !isPositiveInt(assignedTo)) {
    throw httpError("assignedTo is required and must be a positive integer, or null to unassign.", 400);
  }
  return assignedTo === null ? null : Number(assignedTo);
}

const ACTIVITY_TYPES = ["call", "note"]; // "assignment" is server-generated only, not client-postable
function validateCreateActivity(body) {
  const type = body?.type;
  if (!ACTIVITY_TYPES.includes(type)) {
    throw httpError(`type is required and must be one of: ${ACTIVITY_TYPES.join(", ")}.`, 400);
  }
  if (body.remarks !== undefined && !isOptionalString(body.remarks, 5000)) {
    throw httpError("remarks must be a string.", 400);
  }
  if (body.outcome !== undefined && !isOptionalString(body.outcome, 255)) {
    throw httpError("outcome must be a string.", 400);
  }
  if (!body.remarks && !body.outcome) {
    throw httpError("At least one of remarks or outcome is required.", 400);
  }
  return { type, remarks: body.remarks ?? null, outcome: body.outcome ?? null };
}

module.exports = {
  validateCreateLead,
  validateUpdateLead,
  validateStatusChange,
  validateAssignment,
  validateCreateActivity,
  stripProtectedFields,
};
