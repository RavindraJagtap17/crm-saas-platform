const httpError = require("../utils/httpError");
const { isNonEmptyString, isHexColor, isOptionalString } = require("./primitives");

function validateUpdateBranding(body) {
  if (body.name !== undefined && !isNonEmptyString(body.name, 255)) {
    throw httpError("name must be a non-empty string.", 400);
  }
  if (body.logoUrl !== undefined && body.logoUrl !== null && !isOptionalString(body.logoUrl, 1024)) {
    throw httpError("logoUrl must be a string.", 400);
  }
  if (body.brandPrimaryColor !== undefined && body.brandPrimaryColor !== null && !isHexColor(body.brandPrimaryColor)) {
    throw httpError("brandPrimaryColor must be a hex value like #1F5C52.", 400);
  }
  return {
    name: body.name?.trim(),
    logoUrl: body.logoUrl,
    brandPrimaryColor: body.brandPrimaryColor,
  };
}

const VALID_STATUSES = ["pending_payment", "active", "suspended", "canceled"];
function validateStatus(body) {
  if (!VALID_STATUSES.includes(body?.status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(", ")}.`, 400);
  }
  return body.status;
}

// Agency list filter (superAdminService.listTenants) — same VALID_STATUSES
// as validateStatus above, reused rather than re-listed, so there is one
// place that knows the real set of tenant statuses. Optional: undefined in
// means "no filter", not an error.
function validateStatusFilter(status) {
  if (status === undefined) return undefined;
  if (!VALID_STATUSES.includes(status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(", ")}.`, 400);
  }
  return status;
}

// Manual escape-hatch alongside self-service Agency signup (POST
// /api/auth/signup — see auth-signup.js): lets a Super Admin create an
// agency directly and separately invite its first Agency Admin, e.g. for
// support/onboarding cases that don't go through self-service signup.
// Just a name; status/slug are server-computed, same as the self-service
// path.
function validateCreateAgency(body) {
  if (!isNonEmptyString(body?.name, 255)) {
    throw httpError("name is required.", 400);
  }
  return { name: body.name.trim() };
}

module.exports = { validateUpdateBranding, validateStatus, validateStatusFilter, validateCreateAgency };
