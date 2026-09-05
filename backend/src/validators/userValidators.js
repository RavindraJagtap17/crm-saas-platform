const httpError = require("../utils/httpError");
const { isNonEmptyString, isLikelyEmail } = require("./primitives");

// B2B2C restructure: the set of invitable roles is no longer one fixed
// list — it depends on WHO is inviting (Super Admin -> agency_admin,
// Agency Admin -> client_admin, Client Admin -> client_employee). Each
// call site passes its own allowed-roles list rather than this module
// hard-coding a single one.
function validateEmailAndName(body) {
  if (!isLikelyEmail(body?.email)) throw httpError("A valid email is required.", 400);
  if (!isNonEmptyString(body?.name, 255)) throw httpError("name is required.", 400);
  return { email: body.email.trim().toLowerCase(), name: body.name.trim() };
}

function validateInvite(body, allowedRoles) {
  const clean = validateEmailAndName(body);
  if (!allowedRoles.includes(body?.role)) {
    throw httpError(`role must be one of: ${allowedRoles.join(", ")}.`, 400);
  }
  return { ...clean, role: body.role };
}

const VALID_STATUSES = ["active", "deactivated"];
function validateStatusChange(body) {
  if (!VALID_STATUSES.includes(body?.status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(", ")}.`, 400);
  }
  return body.status;
}

module.exports = { validateInvite, validateEmailAndName, validateStatusChange };
