const httpError = require("../utils/httpError");
const { isNonEmptyString, isPositiveInt } = require("./primitives");

// "Agency Admin can create both monthly and yearly Client plans" — exactly
// these two, unlike subscription_plans.billing_cycle's older 4-value set
// (daily/weekly/monthly/yearly), since that flexibility was never part of
// this business rule.
const BILLING_CYCLES = ["monthly", "yearly"];

// Not isPositiveInt: 0 is a valid, if unusual, employee limit under "must
// be a non-negative integer". An upper bound is enforced separately below
// — "should be sensible for the existing schema" (INT UNSIGNED comfortably
// allows this, but a five-digit typo shouldn't silently become a plan
// nobody can ever hit the limit on).
const MAX_SENSIBLE_EMPLOYEES = 100000;
function isSensibleEmployeeLimit(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_SENSIBLE_EMPLOYEES;
}

function validateCreateClientPlan(body) {
  if (!isNonEmptyString(body?.name, 255)) throw httpError("name is required.", 400);
  if (!isPositiveInt(body?.price)) {
    throw httpError("price is required and must be a positive integer (smallest currency unit, e.g. paise).", 400);
  }
  if (body.currency !== undefined && !/^[A-Z]{3}$/.test(body.currency)) {
    throw httpError("currency must be a 3-letter ISO code, e.g. INR.", 400);
  }
  if (!BILLING_CYCLES.includes(body?.billingCycle)) {
    throw httpError(`billingCycle must be one of: ${BILLING_CYCLES.join(", ")}.`, 400);
  }
  if (!isSensibleEmployeeLimit(body?.maxActiveEmployees)) {
    throw httpError(`maxActiveEmployees is required and must be a non-negative integer (0-${MAX_SENSIBLE_EMPLOYEES}).`, 400);
  }

  return {
    name: body.name.trim(),
    price: Number(body.price),
    currency: body.currency || "INR",
    billingCycle: body.billingCycle,
    maxActiveEmployees: Number(body.maxActiveEmployees),
  };
}

function validateUpdateClientPlan(body) {
  if (body.name !== undefined && !isNonEmptyString(body.name, 255)) throw httpError("name must be a non-empty string.", 400);
  if (body.price !== undefined && !isPositiveInt(body.price)) throw httpError("price must be a positive integer.", 400);
  if (body.currency !== undefined && !/^[A-Z]{3}$/.test(body.currency)) throw httpError("currency must be a 3-letter ISO code.", 400);
  if (body.billingCycle !== undefined && !BILLING_CYCLES.includes(body.billingCycle)) {
    throw httpError(`billingCycle must be one of: ${BILLING_CYCLES.join(", ")}.`, 400);
  }
  if (body.maxActiveEmployees !== undefined && !isSensibleEmployeeLimit(body.maxActiveEmployees)) {
    throw httpError(`maxActiveEmployees must be a non-negative integer (0-${MAX_SENSIBLE_EMPLOYEES}).`, 400);
  }
  return {
    name: body.name?.trim(),
    price: body.price !== undefined ? Number(body.price) : undefined,
    currency: body.currency,
    billingCycle: body.billingCycle,
    maxActiveEmployees: body.maxActiveEmployees !== undefined ? Number(body.maxActiveEmployees) : undefined,
  };
}

module.exports = { validateCreateClientPlan, validateUpdateClientPlan, BILLING_CYCLES };
