const httpError = require("../utils/httpError");
const { isPositiveInt, isNonEmptyString } = require("./primitives");

// Same enum integration_events.status itself uses (migration 057) —
// validated here rather than trusted as an arbitrary string, since this
// becomes a WHERE clause value.
const VALID_STATUSES = ["received", "processing", "processed", "duplicate", "failed"];

// Provider stays a free string, not a fixed enum — the exact same
// "shape-only, service layer never assumes a fixed list" precedent
// integrationConnectionService.validateProvider already established, so
// this filter works for every current AND future provider with zero
// changes here.
function validateProviderFilter(provider) {
  if (provider === undefined) return undefined;
  if (!isNonEmptyString(provider, 50) || !/^[a-z0-9_]+$/.test(provider)) {
    throw httpError("provider must be a lowercase alphanumeric/underscore string.", 400);
  }
  return provider;
}

function validateStatusFilter(status) {
  if (status === undefined) return undefined;
  if (!VALID_STATUSES.includes(status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(", ")}.`, 400);
  }
  return status;
}

function validateIdFilter(value, label) {
  if (value === undefined) return undefined;
  if (!isPositiveInt(value)) throw httpError(`${label} must be a positive integer.`, 400);
  return Number(value);
}

// Accepts anything Date can parse (the frontend sends plain "YYYY-MM-DD"
// from a <input type="date">) — validated by round-tripping through Date
// rather than a strict format regex, then normalized to a real MySQL
// DATETIME string so it's never passed through to the query as a raw,
// unvalidated value.
function validateDateFilter(value, label) {
  if (value === undefined || value === "") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError(`${label} must be a valid date.`, 400);
  return date;
}

function validateSearch(value) {
  if (value === undefined || value === "") return undefined;
  if (!isNonEmptyString(value, 255)) throw httpError("search must be a string.", 400);
  return value.trim();
}

/**
 * The one place every query param this feature accepts is validated —
 * mirrors tenantValidators.validateStatusFilter's own shape. Authorization
 * is NEVER decided by anything validated here (see the controller/
 * service: the caller must already be an authenticated super_admin before
 * this is ever reached) — these are search criteria only, exactly as the
 * task itself specifies.
 */
function validateEventFilters(query = {}) {
  return {
    provider: validateProviderFilter(query.provider),
    status: validateStatusFilter(query.status),
    tenantId: validateIdFilter(query.agencyId, "agencyId"),
    clientId: validateIdFilter(query.clientId, "clientId"),
    search: validateSearch(query.search),
    from: validateDateFilter(query.from, "from"),
    to: validateDateFilter(query.to, "to"),
  };
}

module.exports = { validateEventFilters };
