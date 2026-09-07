const httpError = require("../utils/httpError");
const { isNonEmptyString, isGstin, isPhoneNumber, isLikelyEmail } = require("./primitives");

const VALID_STATUSES = ["active", "inactive"];
function validateStatus(body) {
  if (!VALID_STATUSES.includes(body?.status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(", ")}.`, 400);
  }
  return body.status;
}

// "Agency pays per Client" restructure — a Client now carries the same
// business/KYC fields as an Agency (migration 053), filled in by the
// Agency Admin at creation time (the separate "invite the Client Admin
// person" step stays name+email only, unchanged). Same validation rules
// as validateSignupAgency (agencySubscriptionValidators.js) — all required.
function validateCreateClient(body) {
  if (!isNonEmptyString(body?.name, 255)) {
    throw httpError("name is required.", 400);
  }
  if (!isNonEmptyString(body?.address, 500)) {
    throw httpError("address is required.", 400);
  }
  if (!isNonEmptyString(body?.city, 120)) {
    throw httpError("city is required.", 400);
  }
  if (!isGstin(body?.gstNumber)) {
    throw httpError("gstNumber is required and must be a valid 15-character GSTIN.", 400);
  }
  if (!isPhoneNumber(body?.mobile)) {
    throw httpError("mobile is required and must be a valid phone number.", 400);
  }
  // See agencySubscriptionValidators.validateSignupAgency's own comment on
  // why contactEmail is trimmed before isLikelyEmail (which doesn't trim
  // internally, unlike isGstin/isPhoneNumber).
  if (typeof body?.contactEmail !== "string" || !isLikelyEmail(body.contactEmail.trim())) {
    throw httpError("contactEmail is required and must be a valid email address.", 400);
  }
  return {
    name: body.name.trim(),
    address: body.address.trim(),
    city: body.city.trim(),
    gstNumber: body.gstNumber.trim().toUpperCase(),
    mobile: body.mobile.trim(),
    contactEmail: body.contactEmail.trim().toLowerCase(),
  };
}

module.exports = { validateStatus, validateCreateClient };
