const httpError = require("../utils/httpError");
const { isNonEmptyString, isPositiveInt, isPlainObject } = require("./primitives");

// Razorpay's own Plan `period` values — billing_cycle is recorded as one
// of these (verbatim, matching how the Super Admin set the Plan up on
// Razorpay's side), not a freely invented string.
const BILLING_CYCLES = ["daily", "weekly", "monthly", "yearly"];

function validateCreatePlan(body) {
  if (!isNonEmptyString(body?.name, 255)) throw httpError("name is required.", 400);
  if (!isPositiveInt(body?.price)) throw httpError("price is required and must be a positive integer (smallest currency unit, e.g. paise).", 400);
  if (body.currency !== undefined && !/^[A-Z]{3}$/.test(body.currency)) throw httpError("currency must be a 3-letter ISO code, e.g. INR.", 400);
  if (!BILLING_CYCLES.includes(body?.billingCycle)) throw httpError(`billingCycle must be one of: ${BILLING_CYCLES.join(", ")}.`, 400);
  if (body.features !== undefined && body.features !== null && !isPlainObject(body.features)) throw httpError("features must be an object.", 400);
  if (!isNonEmptyString(body?.razorpayPlanId, 64)) throw httpError("razorpayPlanId is required.", 400);

  return {
    name: body.name.trim(),
    price: Number(body.price),
    currency: body.currency || "INR",
    billingCycle: body.billingCycle,
    features: body.features ?? null,
    razorpayPlanId: body.razorpayPlanId.trim(),
  };
}

function validateUpdatePlan(body) {
  if (body.name !== undefined && !isNonEmptyString(body.name, 255)) throw httpError("name must be a non-empty string.", 400);
  if (body.price !== undefined && !isPositiveInt(body.price)) throw httpError("price must be a positive integer.", 400);
  if (body.currency !== undefined && !/^[A-Z]{3}$/.test(body.currency)) throw httpError("currency must be a 3-letter ISO code.", 400);
  if (body.billingCycle !== undefined && !BILLING_CYCLES.includes(body.billingCycle)) {
    throw httpError(`billingCycle must be one of: ${BILLING_CYCLES.join(", ")}.`, 400);
  }
  if (body.features !== undefined && body.features !== null && !isPlainObject(body.features)) throw httpError("features must be an object.", 400);
  // razorpayPlanId is deliberately not editable here — see subscriptionPlanModel.update's comment.
  return {
    name: body.name?.trim(),
    price: body.price !== undefined ? Number(body.price) : undefined,
    currency: body.currency,
    billingCycle: body.billingCycle,
    features: body.features,
  };
}

function validateSubscribeBody(body) {
  if (!isPositiveInt(body?.planId)) throw httpError("planId is required and must be a positive integer.", 400);
  return { planId: Number(body.planId) };
}

const CHANGE_TIMINGS = ["now", "cycle_end"];
function validatePlanChangeBody(body) {
  if (!isPositiveInt(body?.planId)) throw httpError("planId is required and must be a positive integer.", 400);
  if (!CHANGE_TIMINGS.includes(body?.timing)) throw httpError(`timing is required and must be one of: ${CHANGE_TIMINGS.join(", ")}.`, 400);
  return { planId: Number(body.planId), timing: body.timing };
}

module.exports = { validateCreatePlan, validateUpdatePlan, validateSubscribeBody, validatePlanChangeBody, BILLING_CYCLES };
