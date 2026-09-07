const httpError = require("../utils/httpError");
const { isPositiveInt } = require("./primitives");

// Super Admin sets/updates the ONE global price an Agency pays per Client
// added (client_license_price, migration 055). No billing-cycle field: the
// term is fixed at exactly one year by business rule, not configurable.
function validateUpsertClientLicensePrice(body) {
  if (!isPositiveInt(body?.price)) {
    throw httpError("price is required and must be a positive integer (smallest currency unit, e.g. paise).", 400);
  }
  if (body.currency !== undefined && !/^[A-Z]{3}$/.test(body.currency)) {
    throw httpError("currency must be a 3-letter ISO code, e.g. INR.", 400);
  }
  return {
    price: Number(body.price),
    currency: body.currency || "INR",
  };
}

module.exports = { validateUpsertClientLicensePrice };
