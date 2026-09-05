const subscriptionModel = require("../models/subscriptionModel");
const subscriptionPlanModel = require("../models/subscriptionPlanModel");
const paymentModel = require("../models/paymentModel");
const tenantModel = require("../models/tenantModel");
const razorpayWebhookEventModel = require("../models/razorpayWebhookEventModel");
const agencySubscriptionModel = require("../models/agencySubscriptionModel");
const withTransaction = require("../utils/withTransaction");
const logger = require("../utils/logger");

// New business model — Agency grace period is always 7 days (Agency
// billing is always yearly; there is no monthly Agency cycle).
const AGENCY_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

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

// 'grace_period' maps to tenants.status='active' deliberately — the new
// business rule requires the Agency to stay fully usable during its grace
// period ("During grace period Agency remains usable"), so the column
// requireActiveTenant actually gates on is left unchanged from 'active'.
// Grace-period EXPIRY is enforced separately and lazily by
// requireActiveTenant re-checking agency_subscriptions.grace_period_ends_at
// on every request (no scheduler exists in this codebase to proactively
// flip it) — see that file's own comment.
function tenantStatusForAgencySubscription(localStatus) {
  if (localStatus === "active" || localStatus === "grace_period") return "active";
  if (localStatus === "cancelled") return "canceled";
  if (localStatus === "expired") return "suspended";
  return "pending_payment";
}

/**
 * New-business-model counterpart to reconcileSubscriptionEntity above,
 * used ONLY when the incoming event's subscription id has no match in the
 * OLD subscriptions table (see dispatch() below for the routing) — i.e.
 * it belongs to a self-service-signup Agency created under the new flow
 * (billingService.initiateAgencySubscription). reconcileSubscriptionEntity
 * itself is never called or modified by this path.
 *
 * Maps Razorpay's raw status vocabulary onto the new 5-value local one
 * (agency_subscriptions.status), with an explicit local grace-period timer
 * Razorpay itself has no concept of: entering 'pending'/'halted' starts a
 * fixed 7-day local countdown ONLY the first time (a repeat ping while
 * already in grace_period does not reset the deadline); 'active' clears
 * it. 'cancelled' is split into 'cancelled' (this agency's own auto_renew
 * was already false — i.e. WE requested the cycle-end cancellation that
 * just took effect) vs 'expired' (auto_renew was still true — an
 * unrequested/involuntary lapse), matching migration 042's status vocabulary.
 */
async function reconcileAgencySubscriptionEntity(conn, entity) {
  const existing = await agencySubscriptionModel.findByRazorpaySubscriptionId(entity.id, conn);
  if (!existing) {
    logger.warn(`Razorpay webhook: no local subscription (old or new) for razorpay_subscription_id=${entity.id}`);
    return { outcome: "unknown_subscription", tenantId: null };
  }

  let localStatus;
  let gracePeriodEndsAt = existing.grace_period_ends_at;

  if (entity.status === "active") {
    localStatus = "active";
    gracePeriodEndsAt = null;
  } else if (entity.status === "pending" || entity.status === "halted") {
    localStatus = "grace_period";
    if (existing.status !== "grace_period") {
      gracePeriodEndsAt = new Date(Date.now() + AGENCY_GRACE_PERIOD_MS);
    }
  } else if (entity.status === "cancelled") {
    localStatus = existing.auto_renew ? "expired" : "cancelled";
    gracePeriodEndsAt = null;
  } else if (entity.status === "completed" || entity.status === "expired") {
    localStatus = "expired";
    gracePeriodEndsAt = null;
  } else {
    // created / authenticated — not yet paid.
    localStatus = "pending";
  }

  await agencySubscriptionModel.applyWebhookState(conn, entity.id, {
    status: localStatus,
    currentPeriodEnd: toMysqlDatetime(entity.current_end),
    gracePeriodEndsAt,
    razorpayCustomerId: entity.customer_id || undefined,
  });

  const mappedTenantStatus = tenantStatusForAgencySubscription(localStatus);
  await tenantModel.updateStatus(existing.tenant_id, mappedTenantStatus, conn);

  return {
    outcome: "reconciled",
    tenantId: existing.tenant_id,
    subscriptionId: existing.id,
    subscriptionStatus: localStatus,
    tenantStatus: mappedTenantStatus,
  };
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

    // Routing, not modification: an extra indexed lookup decides which of
    // the two independent tables owns this subscription id before doing
    // anything else. When a match IS found in the OLD table, the exact
    // same reconcileSubscriptionEntity() call that always ran here
    // executes, completely unchanged — zero behavior difference for any
    // existing/old-flow tenant. Only when NOTHING matches in the OLD
    // table does the new agency_subscriptions path run instead.
    const isOldFlowSubscription = await subscriptionModel.findByRazorpaySubscriptionId(entity.id, conn);
    const result = isOldFlowSubscription
      ? await reconcileSubscriptionEntity(conn, entity)
      : await reconcileAgencySubscriptionEntity(conn, entity);

    // Payment-ledger recording stays scoped to the OLD flow only — there is
    // no client_payments-equivalent agency ledger table for the new flow
    // yet (deliberately out of this step's scope; see the implementation
    // report). New-flow payments are still fully reflected in
    // agency_subscriptions.status via reconcileAgencySubscriptionEntity
    // above, just not in a separate ledger table.
    if (isOldFlowSubscription && eventType === "subscription.charged" && payload?.payment?.entity && result.subscriptionId) {
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
