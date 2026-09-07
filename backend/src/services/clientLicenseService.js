const clientLicenseModel = require("../models/clientLicenseModel");
const clientLicensePriceService = require("./clientLicensePriceService");
const razorpayClient = require("../integrations/razorpay/razorpayClient");
const config = require("../config");
const withTransaction = require("../utils/withTransaction");

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function serialize(license) {
  if (!license) return null;
  return {
    id: license.id,
    clientId: license.client_id,
    price: license.price,
    currency: license.currency,
    status: effectiveStatus(license),
    currentPeriodEnd: license.current_period_end,
    createdAt: license.created_at,
    updatedAt: license.updated_at,
  };
}

// Lazy-evaluation, same discipline as requireActiveTenant.js's own
// agencyGracePeriodExpired/clientSubscriptionInactive — nothing writes
// 'expired' back to the row at read time; this is display/decision logic
// only. Step 4 wires the same rule into the actual CRM access gate.
function effectiveStatus(license) {
  if (license.status === "active" && license.current_period_end && new Date(license.current_period_end).getTime() < Date.now()) {
    return "expired";
  }
  return license.status;
}

async function getForClient(tenantId, clientId) {
  const license = await clientLicenseModel.findByClient(clientId);
  return serialize(license);
}

/**
 * Used both for a brand-new Client (Add Client) and for an explicit
 * renewal (POST /api/clients/:id/license/renew) — a renewal is simply
 * "initiate again": the SAME function, called again. A still-pending
 * license with an outstanding Order reuses that exact Order's checkout
 * info instead of creating a duplicate — Razorpay Orders don't expire
 * quickly, so reopening Checkout against the same order_id is correct and
 * avoids leaving orphaned Orders behind on every retry.
 *
 * No Customer object is created here (unlike billingService's Subscription
 * flows) — a Razorpay Order needs no pre-created Customer; Checkout's
 * prefill is supplied client-side from the already-logged-in Agency Admin.
 */
async function initiateForClient(tenantId, clientId) {
  const existing = await clientLicenseModel.findByClient(clientId);
  if (existing && existing.status === "pending" && existing.razorpay_order_id) {
    return {
      license: serialize(existing),
      checkout: {
        razorpayKeyId: config.razorpay.keyId,
        razorpayOrderId: existing.razorpay_order_id,
        amount: existing.price,
        currency: existing.currency,
      },
    };
  }

  const price = await clientLicensePriceService.requireConfiguredPrice();

  const order = await razorpayClient.createOrder({
    amount: price.price,
    currency: price.currency,
    receipt: `client_license_${clientId}_${Date.now()}`,
    notes: { crm_tenant_id: String(tenantId), crm_client_id: String(clientId) },
  });

  const license = await clientLicenseModel.upsertPending(null, {
    tenantId,
    clientId,
    price: price.price,
    currency: price.currency,
    razorpayOrderId: order.id,
  });

  return {
    license: serialize(license),
    checkout: {
      razorpayKeyId: config.razorpay.keyId,
      razorpayOrderId: order.id,
      amount: price.price,
      currency: price.currency,
    },
  };
}

/**
 * Webhook confirmation — order.paid / payment.captured both carry a
 * payment entity with id/order_id/amount/currency (see
 * razorpayWebhookService.js's dispatch). No separate payments ledger for
 * this table (matching agency_subscriptions' own established precedent of
 * having none) — idempotency is keyed on client_licenses.razorpay_payment_id
 * directly instead.
 *
 * `conn` is optional and trailing: razorpayWebhookService.processEvent
 * already wraps the whole idempotency-record + dispatch in ONE
 * transaction (see its own docstring on why that atomicity matters) and
 * passes its own conn through here so this activation commits or rolls
 * back together with that outer unit; called standalone (e.g. this step's
 * own verification script) it opens its own transaction instead.
 */
async function confirmPayment(paymentEntity, conn) {
  if (!paymentEntity?.id || !paymentEntity?.order_id || typeof paymentEntity.amount !== "number" || !paymentEntity.currency) {
    return { outcome: "malformed_event" };
  }

  const runner = conn || undefined;
  const license = await clientLicenseModel.findByOrderId(paymentEntity.order_id, runner);
  if (!license) {
    return { outcome: "unknown_order" };
  }

  if (license.razorpay_payment_id === paymentEntity.id) {
    return { outcome: "already_processed" };
  }

  if (paymentEntity.amount !== license.price || paymentEntity.currency !== license.currency) {
    return { outcome: "amount_mismatch" };
  }

  // Anchored to the OLD current_period_end for an early renewal of a
  // still-active license, to "now" for a fresh purchase or a lapsed one —
  // same "anchor to the old period end, not now" discipline
  // clientRenewalService.js already established, simplified (fixed
  // 1-year term, no plan-cycle lookup needed).
  const anchor =
    license.status === "active" && license.current_period_end && new Date(license.current_period_end).getTime() > Date.now()
      ? new Date(license.current_period_end).getTime()
      : Date.now();
  const currentPeriodEnd = new Date(anchor + ONE_YEAR_MS);

  const activate = async (c) => {
    await clientLicenseModel.markActive(c, license.id, { razorpayPaymentId: paymentEntity.id, currentPeriodEnd });
  };
  if (conn) await activate(conn);
  else await withTransaction(activate);

  return { outcome: "activated", clientId: license.client_id, tenantId: license.tenant_id, currentPeriodEnd };
}

module.exports = { getForClient, initiateForClient, confirmPayment, serialize };
