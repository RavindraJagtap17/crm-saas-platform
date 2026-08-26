const httpError = require("../utils/httpError");
const { isNonEmptyString, isLikelyEmail } = require("./primitives");

const INVITABLE_ROLES = ["tenant_admin", "tenant_employee"];

function validateInvite(body) {
  if (!isLikelyEmail(body?.email)) throw httpError("A valid email is required.", 400);
  if (!isNonEmptyString(body?.name, 255)) throw httpError("name is required.", 400);
  if (!INVITABLE_ROLES.includes(body?.role)) {
    throw httpError(`role must be one of: ${INVITABLE_ROLES.join(", ")}.`, 400);
  }
  return { email: body.email.trim().toLowerCase(), name: body.name.trim(), role: body.role };
}

const VALID_STATUSES = ["active", "deactivated"];
function validateStatusChange(body) {
  if (!VALID_STATUSES.includes(body?.status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(", ")}.`, 400);
  }
  return body.status;
}

module.exports = { validateInvite, validateStatusChange, INVITABLE_ROLES };
