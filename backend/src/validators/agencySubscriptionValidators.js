const httpError = require("../utils/httpError");
const { isNonEmptyString, isPositiveInt, isOptionalString } = require("./primitives");

// Super Admin sets/updates the ONE Agency plan (agency_subscription_plan,
// migration 041). billing_cycle is deliberately not accepted here — it is
// fixed to 'yearly' by the business model, not a per-call choice.
function validateUpsertAgencyPlan(body) {
  if (!isPositiveInt(body?.price)) {
    throw httpError("price is required and must be a positive integer (smallest currency unit, e.g. paise).", 400);
  }
  if (body.currency !== undefined && !/^[A-Z]{3}$/.test(body.currency)) {
    throw httpError("currency must be a 3-letter ISO code, e.g. INR.", 400);
  }
  if (body.razorpayPlanId !== undefined && body.razorpayPlanId !== null && !isOptionalString(body.razorpayPlanId, 64)) {
    throw httpError("razorpayPlanId must be a string.", 400);
  }
  return {
    price: Number(body.price),
    currency: body.currency || "INR",
    razorpayPlanId: body.razorpayPlanId ? String(body.razorpayPlanId).trim() : null,
    isActive: body.isActive === undefined ? true : !!body.isActive,
  };
}

// Self-service Agency signup — just the agency name; the signing-up
// person's identity comes from the verified Google ID token, never this
// body. Reuses "name" as the field name for consistency with the old
// Super-Admin validateCreateAgency this supersedes (tenantValidators.js).
function validateSignupAgency(body) {
  if (!isNonEmptyString(body?.name, 255)) {
    throw httpError("name is required.", 400);
  }
  return { name: body.name.trim() };
}

module.exports = { validateUpsertAgencyPlan, validateSignupAgency };
