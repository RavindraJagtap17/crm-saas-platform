const httpError = require("../utils/httpError");
const { isOptionalString, isPositiveInt } = require("./primitives");

// Fields a client is never allowed to set directly — status/completedAt/
// completedBy/cancelledAt only ever change through their own dedicated
// endpoints (complete/cancel), never a generic body, matching leadValidators'
// PROTECTED_FIELDS precedent for leads.status_id/assigned_to.
const PROTECTED_FIELDS = [
  "id",
  "clientId",
  "client_id",
  "leadId",
  "lead_id",
  "status",
  "createdBy",
  "created_by",
  "completedAt",
  "completed_at",
  "completedBy",
  "completed_by",
  "cancelledAt",
  "cancelled_at",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
];

function stripProtectedFields(body) {
  const clean = { ...(body || {}) };
  for (const field of PROTECTED_FIELDS) delete clean[field];
  return clean;
}

// Accepts anything the JS Date constructor can parse — in practice an ISO
// 8601 string built client-side from the date+time picker pair (see §8:
// the browser resolves those two local-timezone fields into one absolute
// instant before it's ever sent here; this layer only validates that the
// result is a real, parseable timestamp, never re-interprets timezone).
function parseScheduledAt(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function validateCreateFollowUp(body) {
  const clean = stripProtectedFields(body);

  const scheduledAt = parseScheduledAt(clean.scheduledAt);
  if (!scheduledAt) throw httpError("scheduledAt is required and must be a valid date/time.", 400);

  const assignedTo = clean.assignedTo;
  if (!isPositiveInt(assignedTo)) throw httpError("assignedTo is required and must be a positive integer.", 400);

  if (clean.notes !== undefined && !isOptionalString(clean.notes, 5000)) {
    throw httpError("notes must be a string.", 400);
  }

  return { scheduledAt, assignedTo: Number(assignedTo), notes: clean.notes || null };
}

// Reschedule / edit — every field optional, but at least one must be
// present (an empty PATCH is almost certainly a caller mistake, not a
// meaningful request).
function validateUpdateFollowUp(body) {
  const clean = stripProtectedFields(body);
  const patch = {};

  if (clean.scheduledAt !== undefined) {
    const scheduledAt = parseScheduledAt(clean.scheduledAt);
    if (!scheduledAt) throw httpError("scheduledAt must be a valid date/time.", 400);
    patch.scheduledAt = scheduledAt;
  }
  if (clean.assignedTo !== undefined) {
    if (!isPositiveInt(clean.assignedTo)) throw httpError("assignedTo must be a positive integer.", 400);
    patch.assignedTo = Number(clean.assignedTo);
  }
  if (clean.notes !== undefined) {
    if (!isOptionalString(clean.notes, 5000)) throw httpError("notes must be a string.", 400);
    patch.notes = clean.notes || null;
  }

  if (Object.keys(patch).length === 0) {
    throw httpError("At least one of scheduledAt, assignedTo, or notes is required.", 400);
  }
  return patch;
}

const FOLLOW_UP_STATUSES = ["pending", "completed", "cancelled"];

// GET /api/follow-ups query parsing — mirrors leadService.listLeads' own
// inline query-parsing style (no separate validator there either; kept
// consistent rather than introducing a new pattern for one endpoint).
function parseListQuery(query = {}) {
  const filters = {};
  if (query.leadId) {
    if (!isPositiveInt(query.leadId)) throw httpError("leadId must be a positive integer.", 400);
    filters.leadId = Number(query.leadId);
  }
  if (query.assignedTo) {
    if (!isPositiveInt(query.assignedTo)) throw httpError("assignedTo must be a positive integer.", 400);
    filters.assignedTo = Number(query.assignedTo);
  }
  if (query.overdue === "true") {
    filters.overdue = true;
  } else if (query.status) {
    if (!FOLLOW_UP_STATUSES.includes(query.status)) {
      throw httpError(`status must be one of: ${FOLLOW_UP_STATUSES.join(", ")}.`, 400);
    }
    filters.status = query.status;
  }
  if (query.dateFrom) {
    const d = parseScheduledAt(query.dateFrom);
    if (!d) throw httpError("dateFrom must be a valid date.", 400);
    filters.dateFrom = d;
  }
  if (query.dateTo) {
    const d = parseScheduledAt(query.dateTo);
    if (!d) throw httpError("dateTo must be a valid date.", 400);
    filters.dateTo = d;
  }
  return filters;
}

module.exports = {
  validateCreateFollowUp,
  validateUpdateFollowUp,
  parseListQuery,
  FOLLOW_UP_STATUSES,
};
