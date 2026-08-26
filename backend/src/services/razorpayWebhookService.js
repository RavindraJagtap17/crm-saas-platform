const subscriptionModel = require("../models/subscriptionModel");
const subscriptionPlanModel = require("../models/subscriptionPlanModel");
const paymentModel = require("../models/paymentModel");
const tenantModel = require("../models/tenantModel");
const razorpayWebhookEventModel = require("../models/razorpayWebhookEventModel");
const withTransaction = require("../utils/withTransaction");
const logger = require("../utils/logger");

// Every Razorpay subscription status this app tracks maps to exactly one
// of these tenant-facing gate values (§G/§H) — the webhook is the ONLY
// writer of tenants.status from this point on for a tenant that has a
// subscription at all. 'created'/'authenticated'/'pending' intentionally
// map to pending_payment: authentication succeeding is not the same as
// the subscription actually being active (§H: don't activate early).
function tenantStatusFor(subscriptionStatus) {
  if (subscriptionStatus === "active") return "active";
  if (["cancelled", "completed", "expired"].includes(subscriptionStatus)) return "canceled";
  if (["halted", "paused"].includes(subscriptionStatus)) return "suspended";
  return "pending_payment";
}

function toMysqlDatetime(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000);
}

/**
 * Handles every `subscription.*` event with one unified function rather
 * than one handler per event name: Razorpay's subscription entity always
 * carries its OWN current `status` (one of exactly the values this
 * schema's ENUM already mirrors) regardless of which event fired it, so
 * reading `entity.status` directly is more robust than hand-mapping each
 * event name to an assumed resulting status. Also picks up a plan change
 * the moment Razorpay confirms it's actually effective (§J) — the local
 * plan_id is only ever written here, never optimistically from the
 * plan-change request itself.
 */
async function reconcileSubscriptionEntity(conn, entity) {
  const existing = await subscriptionModel.findByRazorpaySubscriptionId(entity.id, conn);
  if (!existing) {
    // A webhook for a subscription this app never created — nothing local
    // to reconcile. Not an error; every subscription this app cares about
    // was created by billingService.subscribe() before any webhook for it
    // could possibly arrive, so this only happens for foreign/test data.
    logger.warn(`Razorpay webhook: no local subscription for razorpay_subscription_id=${entity.id}`);
    return { outcome: "unknown_subscription", tenantId: null };
  }

  let planId; // undefined = leave untouched (§J)
  if (entity.plan_id) {
    const localPlan = await subscriptionPlanModel.findByRazorpayPlanId(entity.plan_id, conn);
    if (localPlan) planId = localPlan.id;
    else logger.warn(`Razorpay webhook: entity.plan_id=${entity.plan_id} does not match any local plan — leaving subscriptions.plan_id unchanged`);
  }

  await subscriptionModel.applyWebhookState(conn, entity.id, {
    status: entity.status,
    planId,
    currentPeriodEnd: toMysqlDatetime(entity.current_end),
    razorpayCustomerId: entity.customer_id || undefined,
  });

  const mappedTenantStatus = tenantStatusFor(entity.status);
  await tenantModel.updateStatus(existing.tenant_id, mappedTenantStatus, conn);

  return { outcome: "reconciled", tenantId: existing.tenant_id, subscriptionId: existing.id, subscriptionStatus: entity.status, tenantStatus: mappedTenantStatus };
}

/**
 * subscription.charged carries both the subscription entity AND the
 * payment entity that just succeeded — recorded into the ledger here
 * rather than via a separate payment.captured handler, since Phase 1 has
 * no non-subscription payment flow for that event to apply to (§F: "do
 * not blindly implement every possible webhook event if not needed").
 */
async function recordChargedPayment(conn, tenantId, subscriptionId, paymentEntity) {
  await paymentModel.recordIfAbsent(conn, {
    tenantId,
    subscriptionId,
    razorpayPaymentId: paymentEntity.id,
    razorpayOrderId: paymentEntity.order_id || null,
    amount: paymentEntity.amount,
    currency: paymentEntity.currency,
    status: "captured",
    paidAt: toMysqlDatetime(paymentEntity.created_at),
  });
}

/**
 * §L: recorded for the ledger/troubleshooting only — deliberately never
 * changes subscriptions.status or tenants.status by itself. A failed
 * payment attempt can be followed by a successful retry; what actually
 * governs access is the subscription's own status, reconciled separately
 * via subscription.pending/halted/etc. above.
 */
async function recordFailedPayment(conn, paymentEntity, subscriptionEntity) {
  if (!subscriptionEntity?.id) {
    logger.warn(`Razorpay webhook: payment.failed with no associated subscription — skipping ledger entry (out of Phase 1 scope)`);
    return;
  }
  const subscription = await subscriptionModel.findByRazorpaySubscriptionId(subscriptionEntity.id, conn);
  if (!subscription) return;

  await paymentModel.recordIfAbsent(conn, {
    tenantId: subscription.tenant_id,
    subscriptionId: subscription.id,
    razorpayPaymentId: paymentEntity.id,
    razorpayOrderId: paymentEntity.order_id || null,
    amount: paymentEntity.amount,
    currency: paymentEntity.currency,
    status: "failed",
    paidAt: null,
  });
}

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.completed",
  "subscription.updated",
  "subscription.pending",
  "subscription.halted",
  "subscription.paused",
  "subscription.resumed",
  "subscription.cancelled",
]);

async function dispatch(conn, eventType, payload) {
  if (SUBSCRIPTION_EVENTS.has(eventType)) {
    const entity = payload?.subscription?.entity;
    if (!entity?.id) return { outcome: "malformed_event", tenantId: null };

    const result = await reconcileSubscriptionEntity(conn, entity);
    if (eventType === "subscription.charged" && payload?.payment?.entity && result.subscriptionId) {
      await recordChargedPayment(conn, result.tenantId, result.subscriptionId, payload.payment.entity);
    }
    return result;
  }

  if (eventType === "payment.failed") {
    const paymentEntity = payload?.payment?.entity;
    if (!paymentEntity?.id) return { outcome: "malformed_event", tenantId: null };
    await recordFailedPayment(conn, paymentEntity, payload?.subscription?.entity);
    return { outcome: "payment_failure_recorded", tenantId: null };
  }

  // §F: everything else Razorpay might send (payment.authorized, refund.*,
  // order.paid, ...) is acknowledged and otherwise ignored — there is no
  // local state this app reconciles from them in Phase 1.
  return { outcome: "ignored_event_type", tenantId: null };
}

/**
 * §M: the full idempotency + reconciliation unit, atomic end to end. The
 * "this event was already handled" marker and every local state change it
 * causes are committed TOGETHER in one transaction. If reconciliation
 * throws partway through, withTransaction rolls back EVERYTHING — including
 * the idempotency insert itself — on purpose: a half-applied event must
 * never be remembered as "seen", or a Razorpay retry of the same event id
 * would be silently skipped instead of correctly reprocessing from
 * scratch. A thrown error here propagates to the controller, which
 * responds non-2xx so Razorpay's own retry mechanism tries again later —
 * deliberately not swallowed into a 200, unlike Meta's per-entry webhook
 * (Step 7), since Razorpay delivers exactly one event per request rather
 * than a batch of independent ones.
 */
async function processEvent({ razorpayEventId, eventType, payload }) {
  return withTransaction(async (conn) => {
    const eventRowId = await razorpayWebhookEventModel.recordIfNew(conn, {
      razorpayEventId,
      eventType,
      tenantId: null, // filled in below once dispatch() resolves which tenant this event belongs to
      payload,
    });
    if (eventRowId === null) {
      return { outcome: "already_processed" };
    }

    const result = await dispatch(conn, eventType, payload);

    await razorpayWebhookEventModel.markResult(conn, eventRowId, { processed: true, error: null });
    if (result.tenantId) {
      await conn.query(`UPDATE razorpay_webhook_events SET tenant_id = ? WHERE id = ?`, [result.tenantId, eventRowId]);
    }
    return result;
  });
}

module.exports = { processEvent, tenantStatusFor };
