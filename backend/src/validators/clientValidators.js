const httpError = require("../utils/httpError");

const VALID_STATUSES = ["active", "inactive"];
function validateStatus(body) {
  if (!VALID_STATUSES.includes(body?.status)) {
    throw httpError(`status must be one of: ${VALID_STATUSES.join(", ")}.`, 400);
  }
  return body.status;
}

module.exports = { validateStatus };
