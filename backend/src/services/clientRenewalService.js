const clientSubscriptionModel = require("../models/clientSubscriptionModel");
const clientSubscriptionPlanModel = require("../models/clientSubscriptionPlanModel");
const agencyRazorpayConnectService = require("./agencyRazorpayConnectService");
const razorpayOrderClient = require("../integrations/razorpay/razorpayOrderClient");
const logger = require("../utils/logger");

/**
 * Step 9B — the four Client renewal/grace scheduler jobs (registered by
 * jobs/clientRenewalJobs.js). Each is a plain async function with no
 * arguments, matching scheduler.registerJob's handler shape (Step 9A) —
 * none of them throw on a per-subscription failure; every per-row error
 * is caught and logged so one bad row can never abort the rest of the
 * batch or crash the job (the scheduler itself also catches at the job
 * level, but that would fail the WHOLE run, not just one row).
 *
 * TIMING: client-renewal-orders and client-renewal-grace are separate,
 * independently-scheduled jobs — grace_period is never set as a
 * continuation of the SAME operation that created a renewal Order (see
 * runRenewalOrderCreation/runGraceTransition below). Both may
 * independently examine `current_period_end <= now`, but
 * runGraceTransition only ever matches a row that already HAS a pending
 * Order (set by a prior, separately-committed run of
 * runRenewalOrderCreation) — the two can never be the same database
 * write. No second, separate grace window is introduced anywhere in this
 * file; the customer's only deadline is grace_period_ends_at
 * (current_period_end + 3/7 days), computed once, in
 * clientSubscriptionModel.bulkEnterGracePeriod.
 */

/**
 * client-renewal-orders — creates exactly one Razorpay Order per
 * eligible subscription (active, auto-renewing, past its current period,
 * no Order already pending). Mirrors clientBillingService.chooseSubscription's
 * own order of operations one level up (claim -> external call -> commit
 * or leave retryable), but this is background/backend-only: there is no
 * request body, so nothing about which tenant/client/account to act on
 * is ever anything but this job's own DB read — the Agency's OAuth
 * access_token is resolved fresh per-subscription via
 * agencyRazorpayConnectService, never a token/account id supplied by
 * anything external.
 *
 * Never holds a DB transaction across the external Razorpay call (this
 * codebase's established discipline) — claimRenewalOrder's own optimistic
 * WHERE guard is what makes the final commit safe without one (see its
 * own comment for the accepted "orphaned Order on a lost race" tradeoff).
 * If Order creation fails, nothing was written locally at all — the
 * subscription is untouched and simply eligible again on the next run.
 */
async function runRenewalOrderCreation() {
  const now = new Date();

  // Step 10 — "downgrade target became inactive before renewal": handled
  // FIRST, as its own atomic bulk transition, so any such row is already
  // 'expired' (not 'active') by the time listDueForRenewal runs below —
  // it is structurally impossible for this job to create a renewal Order
  // for a subscription whose requested downgrade target died. See
  // clientSubscriptionModel.bulkExpireForInactiveDowngradeTarget's own
  // comment for why 'expired' (not a new status) is the correct target
  // state.
  const expiredForDeadDowngrade = await clientSubscriptionModel.bulkExpireForInactiveDowngradeTarget(now);
  if (expiredForDeadDowngrade > 0) {
    logger.info(`client-renewal-orders: ${expiredForDeadDowngrade} subscription(s) expired instead of renewed — their requested downgrade target is no longer active.`);
  }

  const due = await clientSubscriptionModel.listDueForRenewal(now);
  let created = 0;
  let skipped = 0;

  for (const subscription of due) {
    try {
      // Step 10 — a previously-requested downgrade (next_plan_id) takes
      // effect AT this renewal: charge the TARGET plan's price, not the
      // current one. (Any row whose next_plan_id pointed at an inactive
      // plan was already diverted to 'expired' above, so any next_plan_id
      // reaching this point is guaranteed active.) No next_plan_id means
      // an ordinary renewal — same subscription.current_price snapshot
      // rule Step 9B already established, unchanged.
      const isDowngradeApplication = !!subscription.next_plan_id;
      const targetPlanId = subscription.next_plan_id || subscription.plan_id;
      const plan = await clientSubscriptionPlanModel.findById(subscription.tenant_id, targetPlanId);
      if (!plan) {
        logger.warn(`client-renewal-orders: plan_id=${targetPlanId} not found for subscription id=${subscription.id} — skipping.`);
        skipped++;
        continue;
      }

      let tokenInfo;
      try {
        await agencyRazorpayConnectService.requireClientPaymentsReady(subscription.tenant_id);
        tokenInfo = await agencyRazorpayConnectService.getValidAccessToken(subscription.tenant_id);
      } catch (err) {
        logger.warn(`client-renewal-orders: tenant_id=${subscription.tenant_id} Razorpay connection not usable — ${err.message}`);
        skipped++;
        continue;
      }
      if (!tokenInfo) {
        logger.warn(`client-renewal-orders: tenant_id=${subscription.tenant_id} has no valid Razorpay access token — skipping subscription id=${subscription.id}.`);
        skipped++;
        continue;
      }

      // IMPORTANT SNAPSHOT RULE: for an ORDINARY renewal, the
      // subscription's own already-snapshotted current_price, never the
      // live plan.price — an Agency Admin may have edited the plan since
      // this Client subscribed/last renewed; existing terms are protected
      // until the relevant billing transition. A DOWNGRADE-APPLICATION
      // renewal IS that transition for the target plan — "the new plan's
      // price... apply from that new billing period" — so it deliberately
      // uses the target plan's CURRENT price, not any stale snapshot
      // (there is nothing to snapshot yet; this is the moment the new
      // period, and its price, is established).
      let order;
      try {
        order = await razorpayOrderClient.createOrder({
          accessToken: tokenInfo.accessToken,
          amount: isDowngradeApplication ? plan.price : subscription.current_price,
          currency: plan.currency,
          receipt: `client-${subscription.client_id}-renewal-${Date.now()}`,
          notes: {
            crm_tenant_id: String(subscription.tenant_id),
            crm_client_id: String(subscription.client_id),
            crm_plan_id: String(plan.id),
            crm_renewal_of_subscription: String(subscription.id),
          },
        });
      } catch (err) {
        // Nothing local was written — safe to just leave this subscription
        // for the next run, no compensation needed.
        logger.warn(`client-renewal-orders: Order creation failed for subscription id=${subscription.id} (tenant_id=${subscription.tenant_id}) — ${err.message}`);
        skipped++;
        continue;
      }

      // Deliberately commits the OLD current_price here — even for a
      // downgrade-application Order — never the new target price. plan_id
      // and current_price only ever change TOGETHER, atomically, once the
      // webhook confirms payment (activateRenewal); until then the
      // subscription must keep showing its true, currently-paid-for terms.
      const claimed = await clientSubscriptionModel.claimRenewalOrder(subscription.tenant_id, subscription.client_id, {
        razorpayOrderId: order.id,
        currentPrice: subscription.current_price,
      });
      if (!claimed) {
        // Lost an optimistic-concurrency race (another run/process already
        // claimed this subscription in the meantime) — the Order just
        // created sits unpaid and unreferenced on Razorpay's side, the
        // same accepted tradeoff already documented on claimRenewalOrder.
        logger.warn(`client-renewal-orders: lost the commit race for subscription id=${subscription.id} — the just-created Order is orphaned (harmless).`);
        skipped++;
        continue;
      }

      created++;
    } catch (err) {
      logger.error(`client-renewal-orders: unexpected error for subscription id=${subscription.id} — ${err.message}`);
      skipped++;
    }
  }

  logger.info(`client-renewal-orders: ${created} renewal Order(s) created, ${skipped} subscription(s) skipped (of ${due.length} candidate(s)).`);
}

/**
 * client-renewal-grace — ACTIVE -> GRACE_PERIOD for any subscription
 * whose renewal Order is still unpaid past its current_period_end. Pure
 * local state transition (no external call), done as one atomic bulk
 * UPDATE in the model layer — see
 * clientSubscriptionModel.bulkEnterGracePeriod's own comment for exactly
 * how the 3-day/7-day deadline is computed and why it can never be reset.
 */
async function runGraceTransition() {
  const now = new Date();
  const count = await clientSubscriptionModel.bulkEnterGracePeriod(now);
  if (count > 0) {
    logger.info(`client-renewal-grace: ${count} subscription(s) moved to grace_period.`);
  }
}

/**
 * client-grace-expiry — GRACE_PERIOD -> EXPIRED once grace_period_ends_at
 * has passed. CRM access is locked purely as a side effect of the status
 * change — requireActiveTenant.js already treats any status other than
 * 'active' (or an unexpired 'grace_period') as inactive, so no gating
 * code changes anywhere else. Data (subscription row, payment history)
 * is never deleted.
 */
async function runGraceExpiry() {
  const now = new Date();
  const count = await clientSubscriptionModel.bulkExpireGracePeriod(now);
  if (count > 0) {
    logger.info(`client-grace-expiry: ${count} subscription(s) expired.`);
  }
}

/**
 * client-cancellation-expiry — ACTIVE + auto_renew=false -> CANCELLED
 * once the already-paid-for current period ends. No renewal Order is
 * ever created for these (client-renewal-orders' own eligibility
 * requires auto_renew=true), so there is nothing else to reconcile here.
 */
async function runCancellationExpiry() {
  const now = new Date();
  const count = await clientSubscriptionModel.bulkCancelAtPeriodEnd(now);
  if (count > 0) {
    logger.info(`client-cancellation-expiry: ${count} subscription(s) cancelled.`);
  }
}

module.exports = {
  runRenewalOrderCreation,
  runGraceTransition,
  runGraceExpiry,
  runCancellationExpiry,
};
