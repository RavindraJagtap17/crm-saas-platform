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

function validateEmployeeLimit(body) {
  const limit = Number(body?.employeeLimit);
  if (!Number.isInteger(limit) || limit < 0) {
    throw httpError("employeeLimit must be a non-negative integer.", 400);
  }
  return limit;
}

module.exports = { validateUpdateBranding, validateStatus, validateEmployeeLimit };
