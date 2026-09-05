const httpError = require("../utils/httpError");
const { isPositiveInt } = require("./primitives");

function validateChoosePlan(body) {
  if (!isPositiveInt(body?.planId)) throw httpError("planId is required and must be a positive integer.", 400);
  return { planId: Number(body.planId) };
}

module.exports = { validateChoosePlan };
