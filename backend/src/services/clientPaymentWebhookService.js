const clientSubscriptionModel = require("../models/clientSubscriptionModel");
const clientSubscriptionPlanModel = require("../models/clientSubscriptionPlanModel");
const clientPaymentModel = require("../models/clientPaymentModel");
const agencyRazorpayConnectService = require("./agencyRazorpayConnectService");
const razorpayOrderClient = require("../integrations/razorpay/razorpayOrderClient");
const withTransaction = require("../utils/withTransaction");
const logger = require("../utils/logger");

/**
 * Step 8D — Client payment webhook processing. Handles order.paid,
 * payment.captured, and payment.failed for a Client's connected-Agency-
 * account Order (Step 8B/8C). Step 9B extends handlePaymentSuccess to
 * also cover RENEWAL Orders (created by clientRenewalService, a scheduler
 * job — see jobs/clientRenewalJobs.js) alongside the original initial-
 * purchase path, and to safely record (without reactivating) a payment
 * that arrives for an Order whose subscription has since gone
 * expired/cancelled. Step 10 further extends it to cover UPGRADE Orders
 * (pending_upgrade_plan_id set — see clientBillingService.requestUpgrade).
 * This is a completely separate reconciliation path from
 * razorpayWebhookService.js (platform Agency billing) and
 * razorpayPartnerWebhook.controller.js (OAuth app-level events) — neither
 * of those files is touched by this step.
 *
 * Resolution is ALWAYS pending_razorpay_order_id -> client_subscriptions
 * -> tenant_id/client_id -> client_subscription_plans (migration 048's
 * UNIQUE(pending_razorpay_order_id) makes this an at-most-one-match
 * lookup) — never a client_id/tenant_id/account_id read from the payload,
 * which never carries one anyway; the caller (the controller) has already
 * verified the webhook's signature against the CLAIMED account's own
 * secret before this function ever runs, and passes only the now-trusted
 * tenantId + eventType + payload down.
 */

// Calendar-accurate: adds exactly `months` calendar months to `date`,
// clamping to the LAST day of the target month when the source day
// doesn't exist there (e.g. Jan 31 + 1 month -> Feb 28/29, not JS Date's
// native rollover to Mar 2/3) — the standard convention for calendar-based
// recurring billing periods, not an arbitrary 30-day approximation.
// Yearly is simply 12 of these (also correctly clamps Feb 29 -> Feb 28 in
// a non-leap target year).
function addCalendarMonths(date, months) {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1); // avoid overflow while changing the month
  result.setMonth(result.getMonth() + months);
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

// current_period_start's application-defined rule: the moment the webhook
// CONFIRMS payment (i.e. "now", server time when this function runs) —
// not the Order-creation time, not a client-reported time. current_period_end
// is exactly one calendar cycle later per the plan's own billing_cycle.
function computeBillingPeriod(billingCycle) {
  const periodStart = new Date();
  const periodEnd = addCalendarMonths(periodStart, billingCycle === "yearly" ? 12 : 1);
  return { periodStart, periodEnd };
}

/**
 * Step 9B — RENEWAL billing period: anchored to the PREVIOUS
 * current_period_end, never to "now" — this is the difference between
 * this function and computeBillingPeriod above, and it exists
 * specifically to avoid billing-anchor drift on a late (grace-period)
 * payment.
 *
 * Worked example (as specified): a monthly period Sep 1 -> Oct 1 (i.e.
 * current_period_end = Oct 1) goes unpaid, enters grace, and is finally
 * paid on Oct 3. Anchoring on "now" would give Oct 3 -> Nov 3, silently
 * shifting the customer's billing date forward every time a payment is
 * late. Anchoring on the OLD current_period_end instead gives exactly
 * Oct 1 -> Nov 1 (i.e. "October", the same calendar period the customer
 * was always due to enter next) — matching the spec's "Oct 1 -> Oct 31"
 * description of that same boundary. The date payment actually posted
 * (Oct 3) affects nothing about the new period's boundaries.
 */
function computeRenewalBillingPeriod(previousPeriodEnd, billingCycle) {
  const periodStart = new Date(previousPeriodEnd);
  const periodEnd = addCalendarMonths(periodStart, billingCycle === "yearly" ? 12 : 1);
  return { periodStart, periodEnd };
}

/**
 * order.paid / payment.captured — both carry a payment entity with
 * `id`/`order_id`/`amount`/`currency` (verified directly against
 * Razorpay's own documented sample payloads for both events); order.paid's
 * payload additionally carries an order entity, unused here since this
 * app already has its OWN authoritative local order/subscription link.
 */
async function handlePaymentSuccess(tenantId, paymentEntity) {
  if (!paymentEntity?.id || !paymentEntity?.order_id || typeof paymentEntity.amount !== "number" || !paymentEntity.currency) {
    return { outcome: "malformed_event" };
  }

  // Idempotency, primary mechanism: a payment_id already recorded means
  // this exact payment has already been fully processed by an earlier
  // delivery — of THIS event type, the other one (order.paid vs.
  // payment.captured), or a genuine retry. No further action, no error.
  const existingPayment = await clientPaymentModel.findByRazorpayPaymentId(paymentEntity.id);
  if (existingPayment) {
    return { outcome: "already_processed" };
  }

  const subscription = await clientSubscriptionModel.findByPendingOrderId(paymentEntity.order_id);
  if (!subscription) {
    // Covers: unknown order id, AND a genuine duplicate delivery arriving
    // AFTER the first one already cleared pending_razorpay_order_id on
    // activation — both are safe no-ops for the same reason (nothing left
    // to resolve to), which is why the `existingPayment` check above is
    // what actually distinguishes "duplicate" from "truly unknown" in the
    // outcome the caller sees.
    logger.warn(`Client payment webhook: no subscription pending for order_id=${paymentEntity.order_id}`);
    return { outcome: "unknown_order" };
  }

  // Ownership: the resolved subscription MUST belong to the SAME agency
  // this webhook's signature was verified against. Structurally this can
  // only ever fail if Razorpay's own order ids somehow collided across
  // accounts (they don't), but re-checking costs nothing and matches this
  // codebase's "never assume, always re-verify ownership" discipline.
  if (subscription.tenant_id !== tenantId) {
    logger.warn(
      `Client payment webhook: order_id=${paymentEntity.order_id} resolved to tenant_id=${subscription.tenant_id}, but the webhook was verified for tenant_id=${tenantId} — refusing to cross-activate.`
    );
    return { outcome: "tenant_mismatch" };
  }

  // Step 10 — an UPGRADE Order is distinguished from a RENEWAL Order by
  // pending_upgrade_plan_id (only ever set by requestUpgrade/
  // retryUpgradePayment) — a subscription can only ever have ONE
  // outstanding Order at a time (a single pending_razorpay_order_id
  // column), so this is a definitive, mutually-exclusive signal, checked
  // BEFORE the renewal logic below. Handled entirely separately: an
  // upgrade never touches current_period_start/current_period_end, uses a
  // prorated (not plan-price) amount, and validates against Razorpay's
  // own Order record rather than a local price expectation (see
  // handleUpgradePaymentSuccess's own comment on why).
  if (subscription.status === "active" && subscription.pending_upgrade_plan_id) {
    return handleUpgradePaymentSuccess(tenantId, subscription, paymentEntity);
  }

  // Step 9B — a subscription already in a TERMINAL state can still
  // resolve here: client-grace-expiry/client-cancellation-expiry
  // deliberately never clear pending_razorpay_order_id (see those
  // transitions' own model-layer comments) precisely so a LATE-arriving
  // payment for that stale Order can still be traced back to the right
  // subscription/client for reconciliation, instead of becoming an
  // unresolvable "unknown_order". Recorded as paid (it genuinely was),
  // but NEVER reactivates the subscription or starts a new billing
  // period — that is exclusively a human/support decision from here.
  if (subscription.status === "expired" || subscription.status === "cancelled") {
    await clientPaymentModel.recordIfAbsent(null, {
      tenantId,
      clientId: subscription.client_id,
      clientSubscriptionId: subscription.id,
      razorpayPaymentId: paymentEntity.id,
      razorpayOrderId: paymentEntity.order_id,
      amount: paymentEntity.amount,
      currency: paymentEntity.currency,
      status: "captured",
      paidAt: paymentEntity.created_at ? new Date(paymentEntity.created_at * 1000) : new Date(),
    });
    logger.warn(
      `Client payment webhook: payment_id=${paymentEntity.id} captured for order_id=${paymentEntity.order_id}, but subscription id=${subscription.id} is already '${subscription.status}' — payment recorded for reconciliation, subscription NOT reactivated.`
    );
    return { outcome: "late_payment_flagged", subscriptionStatus: subscription.status };
  }

  if (!["pending", "active", "grace_period"].includes(subscription.status)) {
    // Unreachable given the 5-value status enum handled above/below, kept
    // as an explicit guard rather than falling through to activation.
    return { outcome: "unexpected_state", subscriptionStatus: subscription.status };
  }

  // Step 9B: 'active' (paid promptly, before the grace job even ran) and
  // 'grace_period' (paid late, during the 3/7-day window) are both a
  // RENEWAL payment. Only 'pending' (the very first purchase) is not.
  const isRenewal = subscription.status === "active" || subscription.status === "grace_period";

  // Step 10 — a renewal that applies a previously-requested downgrade
  // (next_plan_id set) targets a DIFFERENT plan than subscription.plan_id
  // — the renewal job (clientRenewalService) already charged the TARGET
  // plan's price for this exact Order, so validation/activation must
  // check against that same target plan, not the current one.
  const isDowngradeApplication = isRenewal && !!subscription.next_plan_id;
  const targetPlanId = isDowngradeApplication ? subscription.next_plan_id : subscription.plan_id;
  const plan = await clientSubscriptionPlanModel.findById(tenantId, targetPlanId);

  // Ordinary renewal/initial-purchase: the already-snapshotted
  // current_price, never the live plan price (this step's own "Plan Price
  // Snapshot" rule). Downgrade-application: the target plan's CURRENT
  // price IS the correct expectation — "the new plan's price... apply
  // from that new billing period" — there is no prior snapshot for a plan
  // the subscription has never billed before.
  const expectedAmount = isDowngradeApplication ? plan?.price ?? null : subscription.current_price ?? plan?.price ?? null;
  const expectedCurrency = plan?.currency ?? null;

  if (expectedAmount === null || expectedCurrency === null || paymentEntity.amount !== expectedAmount || paymentEntity.currency !== expectedCurrency) {
    // Never activate/renew on a mismatch, never silently adjust the
    // expected price to match what was paid — logged for reconciliation,
    // not recorded as a ledger row (the mismatch is against OUR
    // expectation, not something this step is positioned to safely
    // characterize as a genuine captured/failed payment without
    // inventing behavior).
    logger.warn(
      `Client payment webhook: amount/currency mismatch for subscription id=${subscription.id} (order_id=${paymentEntity.order_id}) — expected ${expectedAmount} ${expectedCurrency}, received ${paymentEntity.amount} ${paymentEntity.currency}. Not activating.`
    );
    return { outcome: "amount_mismatch" };
  }

  // Anchored to the OLD current_period_end, never to "now" (see
  // computeRenewalBillingPeriod's own comment on why) — including for a
  // downgrade-application, which still advances from the SAME billing
  // anchor, just using the target plan's OWN billing_cycle length going
  // forward (a downgrade from yearly to monthly, for example, correctly
  // starts a monthly-length period from here on). Only 'pending' (the
  // very first purchase, no prior period to anchor to) uses "now".
  const { periodStart, periodEnd } = isRenewal
    ? computeRenewalBillingPeriod(subscription.current_period_end, plan.billing_cycle)
    : computeBillingPeriod(plan.billing_cycle);

  // recordIfAbsent's return value (not just its own idempotency) is what
  // gates the state transition below — this is what makes "order.paid
  // AND payment.captured for the very same payment" (or any truly
  // concurrent duplicate delivery) safe even in a genuine race: only the
  // ONE delivery whose INSERT actually wins may ever advance state; the
  // loser sees `inserted: false` and does nothing further, rather than
  // both racing to independently recompute and commit a period.
  const result = await withTransaction(async (conn) => {
    const inserted = await clientPaymentModel.recordIfAbsent(conn, {
      tenantId,
      clientId: subscription.client_id,
      clientSubscriptionId: subscription.id,
      razorpayPaymentId: paymentEntity.id,
      razorpayOrderId: paymentEntity.order_id,
      amount: paymentEntity.amount,
      currency: paymentEntity.currency,
      status: "captured",
      paidAt: paymentEntity.created_at ? new Date(paymentEntity.created_at * 1000) : new Date(),
    });
    if (!inserted) return { inserted: false, transitioned: false };

    const transitioned = isRenewal
      ? await clientSubscriptionModel.activateRenewal(conn, subscription.id, {
          planId: targetPlanId,
          currentPrice: expectedAmount,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          expectedOrderId: paymentEntity.order_id,
        })
      : await clientSubscriptionModel.activate(conn, subscription.id, {
          currentPrice: expectedAmount,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        });
    return { inserted: true, transitioned };
  });

  if (!result.inserted) {
    return { outcome: "already_processed" };
  }
  if (!result.transitioned) {
    // The payment IS recorded above (it genuinely happened), but the
    // guarded UPDATE found the subscription no longer in the expected
    // state by the time it ran — e.g. client-grace-expiry won a race and
    // already moved this row to 'expired' a moment earlier. Never
    // overwrite that backward into 'active'; left exactly as the other
    // transition set it, same principle as the terminal-state branch
    // above.
    logger.warn(
      `Client payment webhook: payment_id=${paymentEntity.id} recorded, but subscription id=${subscription.id} was no longer in the expected state when the transition ran (likely a race with grace/cancellation expiry) — left unchanged.`
    );
    return { outcome: "payment_recorded_state_changed", subscriptionId: subscription.id };
  }

  if (isDowngradeApplication) {
    return { outcome: "downgrade_applied", subscriptionId: subscription.id };
  }
  return { outcome: isRenewal ? "renewed" : "activated", subscriptionId: subscription.id };
}

/**
 * Step 10 — upgrade payment confirmation. Unlike every other path in this
 * file, there is no stable LOCAL "expected amount" to validate against —
 * the amount charged is a one-off prorated figure that depended on "now"
 * at the moment requestUpgrade/retryUpgradePayment ran, and recomputing
 * proration again here (at a DIFFERENT "now") would produce a different,
 * wrong number. Instead, this fetches the Order itself back from Razorpay
 * (razorpayOrderClient.fetchOrder, the same already-integrated,
 * defensively-treated call retryPayment uses) and validates the payment
 * against THAT — Razorpay Orders are immutable once created, so the
 * Order's own `amount` is the exact, authoritative figure this specific
 * Order was configured to charge, with no drift risk. Any failure to
 * verify (no valid token, fetch fails, mismatch) safely refuses to
 * activate rather than guessing — the payment is still recorded (it
 * genuinely happened) so nothing is lost, and the Client can retry.
 *
 * Never touches current_period_start/current_period_end — "the upgrade
 * must not extend the billing period."
 */
async function handleUpgradePaymentSuccess(tenantId, subscription, paymentEntity) {
  const targetPlan = await clientSubscriptionPlanModel.findById(tenantId, subscription.pending_upgrade_plan_id);
  if (!targetPlan) {
    logger.warn(`Client payment webhook: upgrade target plan_id=${subscription.pending_upgrade_plan_id} not found for subscription id=${subscription.id} — cannot activate.`);
    return { outcome: "upgrade_target_plan_missing" };
  }

  const tokenInfo = await agencyRazorpayConnectService.getValidAccessToken(tenantId);
  if (!tokenInfo) {
    logger.warn(`Client payment webhook: no valid Razorpay access token for tenant_id=${tenantId} — cannot verify upgrade Order amount for subscription id=${subscription.id}.`);
    return { outcome: "upgrade_verification_failed" };
  }

  let orderRecord;
  try {
    orderRecord = await razorpayOrderClient.fetchOrder({ accessToken: tokenInfo.accessToken, orderId: paymentEntity.order_id });
  } catch (err) {
    logger.warn(`Client payment webhook: could not fetch Order ${paymentEntity.order_id} to verify upgrade amount for subscription id=${subscription.id} — ${err.message}`);
    return { outcome: "upgrade_verification_failed" };
  }

  if (paymentEntity.amount !== orderRecord.amount || paymentEntity.currency !== orderRecord.currency) {
    logger.warn(
      `Client payment webhook: upgrade payment amount/currency mismatch for subscription id=${subscription.id} (order_id=${paymentEntity.order_id}) — Order record says ${orderRecord.amount} ${orderRecord.currency}, payment reports ${paymentEntity.amount} ${paymentEntity.currency}. Not activating.`
    );
    return { outcome: "amount_mismatch" };
  }

  const result = await withTransaction(async (conn) => {
    const inserted = await clientPaymentModel.recordIfAbsent(conn, {
      tenantId,
      clientId: subscription.client_id,
      clientSubscriptionId: subscription.id,
      razorpayPaymentId: paymentEntity.id,
      razorpayOrderId: paymentEntity.order_id,
      amount: paymentEntity.amount,
      currency: paymentEntity.currency,
      status: "captured",
      paidAt: paymentEntity.created_at ? new Date(paymentEntity.created_at * 1000) : new Date(),
    });
    if (!inserted) return { inserted: false, transitioned: false };

    // "Update current_price to target plan price" — the target plan's own
    // (current) price, NOT the prorated amount just charged; the
    // prorated amount was a one-time top-up for the remainder of THIS
    // cycle, current_price is the snapshot future renewals will use.
    const transitioned = await clientSubscriptionModel.activateUpgrade(conn, subscription.id, {
      planId: targetPlan.id,
      currentPrice: targetPlan.price,
      expectedOrderId: paymentEntity.order_id,
    });
    return { inserted: true, transitioned };
  });

  if (!result.inserted) {
    return { outcome: "already_processed" };
  }
  if (!result.transitioned) {
    logger.warn(
      `Client payment webhook: upgrade payment_id=${paymentEntity.id} recorded, but subscription id=${subscription.id} was no longer in the expected state when the transition ran — left unchanged.`
    );
    return { outcome: "payment_recorded_state_changed", subscriptionId: subscription.id };
  }

  return { outcome: "upgraded", subscriptionId: subscription.id };
}

/**
 * payment.failed — recorded for the ledger/troubleshooting only, exactly
 * mirroring razorpayWebhookService.recordFailedPayment's discipline one
 * level up: never changes subscription status by itself, regardless of
 * whether the failed Order was an initial purchase (subscription stays
 * 'pending') or a renewal (subscription stays whatever it already was —
 * 'active' or 'grace_period'). The active -> grace_period transition for
 * an unpaid renewal is exclusively client-renewal-grace's job (a
 * scheduled sweep, not this event-driven handler) — see
 * clientRenewalService.js — so a failed-then-later-succeeding renewal
 * attempt within the same grace window is never blocked by anything
 * this function does.
 */
async function handlePaymentFailed(tenantId, paymentEntity) {
  if (!paymentEntity?.id) return { outcome: "malformed_event" };
  if (!paymentEntity.order_id) {
    logger.warn(`Client payment webhook: payment.failed with no order_id — skipping ledger entry (cannot resolve a subscription without one)`);
    return { outcome: "malformed_event" };
  }

  const existingPayment = await clientPaymentModel.findByRazorpayPaymentId(paymentEntity.id);
  if (existingPayment) return { outcome: "already_processed" };

  const subscription = await clientSubscriptionModel.findByPendingOrderId(paymentEntity.order_id);
  if (!subscription || subscription.tenant_id !== tenantId) {
    return { outcome: "unknown_order" };
  }

  await clientPaymentModel.recordIfAbsent(null, {
    tenantId,
    clientId: subscription.client_id,
    clientSubscriptionId: subscription.id,
    razorpayPaymentId: paymentEntity.id,
    razorpayOrderId: paymentEntity.order_id,
    amount: paymentEntity.amount ?? 0,
    currency: paymentEntity.currency ?? "INR",
    status: "failed",
    paidAt: null,
  });

  return { outcome: "failure_recorded" };
}

async function processEvent({ tenantId, eventType, payload }) {
  if (eventType === "order.paid" || eventType === "payment.captured") {
    return handlePaymentSuccess(tenantId, payload?.payment?.entity);
  }
  if (eventType === "payment.failed") {
    return handlePaymentFailed(tenantId, payload?.payment?.entity);
  }
  // Everything else this app doesn't reconcile from in Phase 1 — acknowledged
  // and otherwise ignored, same convention as the existing Agency webhook.
  return { outcome: "ignored_event_type" };
}

module.exports = { processEvent };
