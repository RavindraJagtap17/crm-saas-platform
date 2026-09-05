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

// B2B2C restructure: agencies are now created by a Super Admin
// (superAdminService.createAgency) rather than via self-service signup —
// this is that flow's input validation. Just a name; status/slug are
// server-computed, same as the old signup path.
function validateCreateAgency(body) {
  if (!isNonEmptyString(body?.name, 255)) {
    throw httpError("name is required.", 400);
  }
  return { name: body.name.trim() };
}

module.exports = { validateUpdateBranding, validateStatus, validateCreateAgency };
