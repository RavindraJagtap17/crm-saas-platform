const clientLicensePriceModel = require("../models/clientLicensePriceModel");
const auditLogModel = require("../models/auditLogModel");
const httpError = require("../utils/httpError");
const { validateUpsertClientLicensePrice } = require("../validators/clientLicenseValidators");

// Super Admin's own view — full record.
async function get() {
  return clientLicensePriceModel.get();
}

// Used by clientLicenseService.initiateForClient before ever calling
// Razorpay — mirrors agencySubscriptionPlanService.requireActivePlan's own
// guard exactly (same reasoning: a price alone must exist before an
// Agency can be charged for adding a Client).
async function requireConfiguredPrice() {
  const price = await clientLicensePriceModel.get();
  if (!price) {
    throw httpError("Client licensing is not currently available. Please contact the platform administrator.", 503, "CLIENT_LICENSE_PRICE_NOT_CONFIGURED");
  }
  return price;
}

async function upsert(body, actorUserId) {
  const clean = validateUpsertClientLicensePrice(body);
  const existed = !!(await clientLicensePriceModel.get());
  const price = await clientLicensePriceModel.upsert(clean);
  await auditLogModel.create({
    tenantId: null,
    userId: actorUserId,
    action: existed ? "client_license_price.updated" : "client_license_price.created",
    entityType: "client_license_price",
    entityId: price.id,
    meta: { price: price.price, currency: price.currency },
  });
  return price;
}

module.exports = { get, upsert, requireConfiguredPrice };
