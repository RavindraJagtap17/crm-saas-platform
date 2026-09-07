const httpError = require("../utils/httpError");
const { isNonEmptyString, isPhoneNumber, isGstin, isLikelyEmail } = require("./primitives");

// Self-service Agency signup — the signing-up person's own identity still
// comes only from the verified Google ID token (never this body), but the
// new business model now also requires the Agency's own business/KYC
// details up front: address, city, GST number, mobile, and a business
// contact email (deliberately separate from the Google-verified email —
// see tenantModel.createTenant's own comment). All required, all stored
// on tenants directly (migration 052).
function validateSignupAgency(body) {
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
  // isLikelyEmail, unlike isGstin/isPhoneNumber, doesn't trim internally
  // (its only other caller is a Google-verified email, never hand-typed) —
  // trim here first so stray whitespace in this hand-typed field doesn't
  // fail validation the way it wouldn't for any other field.
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

module.exports = { validateSignupAgency };
