const clientSubscriptionModel = require("../models/clientSubscriptionModel");
const clientSubscriptionPlanModel = require("../models/clientSubscriptionPlanModel");
const agencyRazorpayConnectService = require("./agencyRazorpayConnectService");
const razorpayOrderClient = require("../integrations/razorpay/razorpayOrderClient");
const withTransaction = require("../utils/withTransaction");
const httpError = require("../utils/httpError");
const { validateChoosePlan } = require("../validators/clientBillingValidators");

/**
 * ============================================================================
 * RAZORPAY INTEGRATION BOUNDARY — read before extending this file.
 *
 * Step 3/5/7/8 research found NO official Razorpay documentation confirming
 * that a Razorpay PLAN or SUBSCRIPTION can be created for a connected
 * Agency account using the Technology Partner OAuth mechanism — the
 * official Partner "product configuration" API (the mechanism that enables
 * any capability for a connected account) only ever accepts
 * `payment_gateway` or `payment_links` as a product name; Subscriptions is
 * not an option (Step 8 verification). Client billing is therefore built
 * on Razorpay ORDERS + PAYMENTS only (§F/§G of the Step 8 design report),
 * never Plans, Subscriptions, or Route.
 *
 * As of Step 8B, chooseSubscription() DOES create one real Razorpay Order
 * per initial purchase, using razorpayOrderClient.js against the caller's
 * own Agency's connected account (via agencyRazorpayConnectService —
 * Step 5's OAuth token/refresh mechanism, unchanged). It still never
 * marks a subscription 'active' — only a verified webhook (Step 8C, not
 * yet built) may do that; the browser is never trusted for activation, and
 * this file never calls razorpayClient.js (platform credentials) or
 * razorpayPartnerClient.js (OAuth code/token exchange only) for a Client
 * payment. cancelSubscription() remains local-only (see its own comment) —
 * there is still no Razorpay Subscription object to cancel under the
 * Orders model, and renewal/proration Orders are future work (Step 8C+).
 * ============================================================================
 */

// Never includes pending_razorpay_order_id, razorpay_customer_id, or any
// other Razorpay identifier that isn't needed by the frontend — the order
// id/amount/currency a Checkout needs are returned separately, only from
// chooseSubscription's own fresh response (see its `checkout` field),
// never as a general property of "the subscription."
function serialize(subscription) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    planId: subscription.plan_id,
    nextPlanId: subscription.next_plan_id,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    currentPrice: subscription.current_price,
    gracePeriodEndsAt: subscription.grace_period_ends_at,
    autoRenew: !!subscription.auto_renew,
    // Step 9B: a derived boolean, not the raw Razorpay order id itself
    // (that's returned only from a fresh checkout/payRenewal response) —
    // true exactly when there's an outstanding renewal Order the Client
    // can pay right now (status active/grace_period AND a pending Order
    // exists; the initial-purchase 'pending' status uses its own
    // isRetryable path on the frontend, unrelated to this flag).
    renewalDue: ["active", "grace_period"].includes(subscription.status) && !!subscription.pending_razorpay_order_id && !subscription.pending_upgrade_plan_id,
    // Step 10 — true exactly while an upgrade payment is outstanding
    // (Order created, not yet webhook-confirmed). Mutually exclusive with
    // renewalDue — a subscription has only one pending_razorpay_order_id,
    // so it is either a renewal Order or an upgrade Order, never both.
    upgradePending: subscription.status === "active" && !!subscription.pending_upgrade_plan_id,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at,
  };
}

function serializePlanSummary(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    billingCycle: plan.billing_cycle,
    maxActiveEmployees: plan.max_active_employees,
  };
}

// "Client sees active plans belonging only to its Agency" (Part B) —
// reuses clientSubscriptionPlanModel.listActiveByTenant, written in Step 6
// but never wired to a route until now.
async function listActivePlans(tenantId) {
  const plans = await clientSubscriptionPlanModel.listActiveByTenant(tenantId);
  return plans.map(serializePlanSummary);
}

async function getCurrentSubscription(tenantId, clientId) {
  const subscription = await clientSubscriptionModel.findByClient(clientId);
  if (!subscription) return { subscription: null, plan: null, nextPlan: null };
  // Defensive re-check rather than assumed: plan_id is only ever set by
  // this same service, already tenant-validated at that time, but costs
  // nothing to re-confirm ownership on every read.
  const plan = await clientSubscriptionPlanModel.findById(tenantId, subscription.plan_id);
  // Step 10 — resolved for the billing page's "downgrade scheduled to X"
  // display; null whenever no downgrade is pending. Read-only: this is
  // NOT re-validated as still-active here (that only matters at the
  // renewal that actually applies it — see
  // clientSubscriptionModel.bulkExpireForInactiveDowngradeTarget) — a
  // plan that's since been deactivated is still shown honestly as what
  // was requested, not hidden.
  const nextPlan = subscription.next_plan_id ? await clientSubscriptionPlanModel.findById(tenantId, subscription.next_plan_id) : null;
  return { subscription: serialize(subscription), plan: serializePlanSummary(plan), nextPlan: serializePlanSummary(nextPlan) };
}

/**
 * "Client chooses a plan" (Part D) — Step 8B: now creates exactly one real
 * Razorpay Order for the initial purchase, up to (but not past) the
 * verified Razorpay boundary documented above. Validates: plan exists AND
 * belongs to the caller's own agency (never trusts a cross-agency planId),
 * plan is active, the agency's Razorpay account is connected (Step 5),
 * and that the client does not already have a subscription in progress or
 * active (this single status check also covers "no outstanding pending
 * Order" — a row can only ever be 'pending' if it has one, per this
 * function's own invariant).
 *
 * Order of operations is deliberate:
 *   1. Claim the one-row-per-client slot in a SHORT transaction (row lock
 *      via findByClientForUpdate — this is what actually prevents two
 *      concurrent requests from both proceeding to create an Order for the
 *      same client; the transaction never spans the Razorpay call itself).
 *   2. Create the Razorpay Order OUTSIDE any transaction — matches this
 *      codebase's established discipline of never holding a DB transaction
 *      across an external API call (see billingService.subscribe()).
 *   3. Only on success, commit the order id + price snapshot as one final
 *      write. On failure, compensate: delete the row if it was newly
 *      inserted, or restore it to its exact prior state if it was reused —
 *      "do not leave a broken pending subscription/order state."
 */
async function chooseSubscription(tenantId, clientId, body) {
  const { planId } = validateChoosePlan(body);

  const plan = await clientSubscriptionPlanModel.findById(tenantId, planId);
  if (!plan) throw httpError("Plan not found.", 404);
  if (!plan.is_active) throw httpError("This plan is not available.", 400, "PLAN_NOT_AVAILABLE");

  // Step 8E: "connected" alone is not enough — the connection must ALSO
  // have a provisioned Client-payment webhook, or a successful payment
  // could never be locally confirmed. Fails fast, before any DB write.
  await agencyRazorpayConnectService.requireClientPaymentsReady(tenantId);

  // Phase 1: claim the slot under a row lock.
  const claim = await withTransaction(async (conn) => {
    const existing = await clientSubscriptionModel.findByClientForUpdate(conn, clientId);
    if (existing && ["pending", "active", "grace_period"].includes(existing.status)) {
      throw httpError(
        "This client already has a subscription in progress or active.",
        409,
        "SUBSCRIPTION_ALREADY_EXISTS"
      );
    }
    if (existing) {
      await clientSubscriptionModel.restartWithPlan(conn, tenantId, clientId, planId);
      return { wasExisting: true, priorRow: existing };
    }
    const created = await clientSubscriptionModel.create(conn, tenantId, clientId, planId);
    return { wasExisting: false, insertedId: created.id };
  });

  // Phase 2: get a valid Bearer token for THIS agency's connected account
  // (Step 5's refresh mechanism, unchanged) and create the Order —
  // deliberately outside the transaction above.
  let order;
  let publicToken;
  try {
    const tokenInfo = await agencyRazorpayConnectService.getValidAccessToken(tenantId);
    if (!tokenInfo) {
      throw httpError(
        "Your agency's Razorpay connection needs to be reconnected. Ask your agency administrator to reconnect it.",
        400,
        "AGENCY_RAZORPAY_NOT_CONNECTED"
      );
    }
    if (!tokenInfo.publicToken) {
      // A connection made before Step 8C's public_token capture (or one
      // Razorpay never returned it for) — Checkout cannot be assembled
      // without it, so this is treated the same as "not usable" rather
      // than silently returning incomplete checkout data.
      throw httpError(
        "Your agency's Razorpay connection is missing required Checkout data. Ask your agency administrator to reconnect it.",
        400,
        "AGENCY_RAZORPAY_PUBLIC_TOKEN_MISSING"
      );
    }
    publicToken = tokenInfo.publicToken;
    order = await razorpayOrderClient.createOrder({
      accessToken: tokenInfo.accessToken,
      amount: plan.price,
      currency: plan.currency,
      // Never contains any secret — a plain, human-traceable reference.
      receipt: `client-${clientId}-plan-${planId}-${Date.now()}`,
      notes: { crm_tenant_id: String(tenantId), crm_client_id: String(clientId), crm_plan_id: String(planId) },
    });
  } catch (err) {
    // Phase 3: compensating rollback — never report success, never leave a
    // pending row with no order behind it.
    if (claim.wasExisting) {
      await clientSubscriptionModel.restoreRow(tenantId, clientId, claim.priorRow);
    } else {
      await clientSubscriptionModel.deleteById(claim.insertedId);
    }
    throw err;
  }

  // Phase 4: commit the confirmed order id + the CURRENT cycle's price
  // snapshot (§7 of the Step 8 design — later plan-price edits must never
  // silently change what an already-chosen subscription is charged).
  const updated = await clientSubscriptionModel.setPendingOrder(tenantId, clientId, {
    razorpayOrderId: order.id,
    currentPrice: plan.price,
  });

  return {
    subscription: serialize(updated),
    plan: serializePlanSummary(plan),
    // The minimum Checkout needs (Step 8C, verified against Razorpay's own
    // Technology Partner Checkout example): order id, amount, currency,
    // and the Agency's own public_token — resolved above from THIS caller's
    // own tenantId only, never accepted from the request. Never
    // access_token/refresh_token/webhook secret/client_secret.
    checkout: { razorpayOrderId: order.id, amount: order.amount, currency: order.currency, publicToken },
  };
}

/**
 * Step 8E — Task 2: retries a failed/abandoned INITIAL purchase attempt.
 * Step 10 extends this to ALSO cover a failed/abandoned UPGRADE payment
 * attempt (status='active' with pending_upgrade_plan_id set) — the two
 * are structurally analogous ("an outstanding unpaid Order exists, verify
 * it wasn't secretly paid, then replace it") so they share this one
 * function rather than a separate parallel endpoint. Deliberately a
 * separate function from chooseSubscription/requestUpgrade rather than a
 * parameter on them — the preconditions are the opposite (an EXISTING
 * pending row with an outstanding order is REQUIRED here).
 *
 * "Do not assume an old Order was paid just because it exists" AND "do not
 * assume it wasn't" — before replacing it, this fetches the OLD order's
 * live status from Razorpay (via the Agency's own OAuth access_token,
 * razorpayOrderClient.fetchOrder — see that function's header comment on
 * why this specific call is labeled NOT independently re-verified for
 * Bearer auth, and handled defensively as a result: ANY failure of this
 * check — including an auth rejection — blocks the retry rather than
 * proceeding as if unpaid, satisfying "if the old Order actually succeeded
 * ... do NOT create a second charge" without guessing).
 */
async function retryPayment(tenantId, clientId) {
  const existing = await clientSubscriptionModel.findByClient(clientId);
  if (!existing) throw httpError("No subscription found for this client.", 404, "NO_SUBSCRIPTION");

  const isInitialPurchaseRetry = existing.status === "pending" && !!existing.pending_razorpay_order_id;
  const isUpgradeRetry = existing.status === "active" && !!existing.pending_upgrade_plan_id && !!existing.pending_razorpay_order_id;

  if (!isInitialPurchaseRetry && !isUpgradeRetry) {
    // "Do not allow retry if subscription is: active [with no pending
    // upgrade], grace_period, cancelled, expired" — and a 'pending' row
    // with no order at all has nothing to retry (chooseSubscription is
    // the correct call for that).
    throw httpError(
      `This subscription cannot be retried in its current state (${existing.status}).`,
      400,
      "NOT_RETRYABLE"
    );
  }

  const tokenInfo = await agencyRazorpayConnectService.getValidAccessToken(tenantId);
  if (!tokenInfo?.publicToken) {
    throw httpError(
      "Your agency's Razorpay connection needs to be reconnected. Ask your agency administrator to reconnect it.",
      400,
      "AGENCY_RAZORPAY_NOT_CONNECTED"
    );
  }

  let oldOrder;
  try {
    oldOrder = await razorpayOrderClient.fetchOrder({ accessToken: tokenInfo.accessToken, orderId: existing.pending_razorpay_order_id });
  } catch (err) {
    // Cannot safely determine whether the old Order was already paid —
    // per instruction, this blocks the retry rather than risking a
    // duplicate charge.
    throw httpError(
      "Could not safely verify your previous payment attempt. Please try again shortly.",
      502,
      "RAZORPAY_ORDER_STATUS_UNKNOWN"
    );
  }

  if (oldOrder.status === "paid") {
    // Genuinely paid but the confirming webhook hasn't arrived/processed
    // yet — never create a second Order/charge; the existing webhook path
    // (Step 8D/10) will activate this on its own shortly.
    throw httpError(
      "Your previous payment appears to have succeeded and is being confirmed. Please wait a moment and check again.",
      409,
      "PAYMENT_ALREADY_SUCCEEDED"
    );
  }

  if (isUpgradeRetry) {
    return retryUpgradePayment(tenantId, clientId, existing, tokenInfo);
  }

  const plan = await clientSubscriptionPlanModel.findById(tenantId, existing.plan_id);
  if (!plan) throw httpError("Plan not found.", 404);

  let newOrder;
  try {
    newOrder = await razorpayOrderClient.createOrder({
      accessToken: tokenInfo.accessToken,
      // Preserve the ORIGINALLY-snapshotted price — this is still the same
      // purchase attempt, just a retried payment, never re-derived from
      // the (possibly since-edited) live plan price.
      amount: existing.current_price ?? plan.price,
      currency: plan.currency,
      receipt: `client-${clientId}-retry-${Date.now()}`,
      notes: { crm_tenant_id: String(tenantId), crm_client_id: String(clientId), crm_plan_id: String(plan.id), crm_retry_of: existing.pending_razorpay_order_id },
    });
  } catch (err) {
    // Nothing local has changed yet — no compensation needed, the existing
    // pending row + old (unpaid) order id are simply left exactly as they were.
    throw err;
  }

  // Optimistic-concurrency commit — see replacePendingOrder's own comment.
  const updated = await clientSubscriptionModel.replacePendingOrder(tenantId, clientId, {
    previousOrderId: existing.pending_razorpay_order_id,
    razorpayOrderId: newOrder.id,
    currentPrice: existing.current_price ?? plan.price,
  });
  if (!updated) {
    // Something changed the row between our read and this write (a
    // webhook activated it, or a concurrent retry already replaced the
    // order) — the NEW Order we just created is simply never referenced
    // by anything locally and will just sit unpaid on Razorpay's side;
    // safer than silently overwriting state a webhook may have just set.
    throw httpError(
      "Your subscription's status changed while retrying. Please refresh and try again.",
      409,
      "RETRY_STATE_CHANGED"
    );
  }

  return {
    subscription: serialize(updated),
    plan: serializePlanSummary(plan),
    checkout: { razorpayOrderId: newOrder.id, amount: newOrder.amount, currency: newOrder.currency, publicToken: tokenInfo.publicToken },
  };
}

/**
 * Step 10 — retryPayment's upgrade-specific branch: the OLD Order (for
 * `existing.pending_upgrade_plan_id`) has already been confirmed unpaid by
 * the caller. The proration amount is RECOMPUTED here against "now" at
 * retry time (never reused from the original, now-stale, attempt) —
 * "remaining_days" genuinely changed since the first attempt, so a stale
 * amount would either overcharge or undercharge. If the target plan died
 * in the meantime, the stale claim is cleared (never silently charged/
 * applied) and the Client is told to choose again — same principle as
 * downgrade's inactive-target handling.
 */
async function retryUpgradePayment(tenantId, clientId, existing, tokenInfo) {
  const targetPlan = await clientSubscriptionPlanModel.findById(tenantId, existing.pending_upgrade_plan_id);
  if (!targetPlan || !targetPlan.is_active) {
    await clientSubscriptionModel.clearPendingUpgrade(tenantId, clientId, existing.pending_razorpay_order_id);
    throw httpError("The plan you were upgrading to is no longer available. Please choose a plan again.", 400, "UPGRADE_TARGET_PLAN_UNAVAILABLE");
  }

  const currentPlan = await clientSubscriptionPlanModel.findById(tenantId, existing.plan_id);
  const currentApplicablePrice = existing.current_price ?? currentPlan?.price ?? null;
  if (currentApplicablePrice === null) throw httpError("Could not determine the current plan's price.", 500);

  const { amountDue } = computeUpgradeProration({
    currentPrice: currentApplicablePrice,
    currentPeriodStart: existing.current_period_start,
    currentPeriodEnd: existing.current_period_end,
    targetPlanPrice: targetPlan.price,
  });
  if (amountDue === 0) {
    // See requestUpgrade's own comment — no verified Razorpay support for
    // a zero-value Order; a genuine business decision, not a guess.
    throw httpError(
      "This upgrade currently has no additional amount due. This case needs a manual decision — contact your agency administrator.",
      409,
      "UPGRADE_ZERO_AMOUNT_UNSUPPORTED"
    );
  }

  let newOrder;
  try {
    newOrder = await razorpayOrderClient.createOrder({
      accessToken: tokenInfo.accessToken,
      amount: amountDue,
      currency: targetPlan.currency,
      receipt: `client-${clientId}-upgrade-retry-${Date.now()}`,
      notes: {
        crm_tenant_id: String(tenantId),
        crm_client_id: String(clientId),
        crm_upgrade_to_plan_id: String(targetPlan.id),
        crm_retry_of: existing.pending_razorpay_order_id,
      },
    });
  } catch (err) {
    throw err;
  }

  const updated = await clientSubscriptionModel.replaceUpgradeOrder(tenantId, clientId, {
    previousOrderId: existing.pending_razorpay_order_id,
    razorpayOrderId: newOrder.id,
    pendingUpgradePlanId: targetPlan.id,
  });
  if (!updated) {
    throw httpError("Your subscription's status changed while retrying. Please refresh and try again.", 409, "RETRY_STATE_CHANGED");
  }

  return {
    subscription: serialize(updated),
    plan: serializePlanSummary(targetPlan),
    proration: { amountDue },
    checkout: { razorpayOrderId: newOrder.id, amount: newOrder.amount, currency: newOrder.currency, publicToken: tokenInfo.publicToken },
  };
}

/**
 * Step 9B — re-serves Checkout details for the CURRENT pending renewal
 * Order (created by the client-renewal-orders scheduler job) so the
 * Client can actually pay it. This is deliberately NOT retryPayment:
 * retryPayment creates a brand-new Order for a failed INITIAL purchase
 * (status='pending'); this never creates a new Order at all — "Do not
 * create a second renewal Order while the first pending Order remains
 * valid" — it only re-reads the Order id already committed by the
 * renewal job and re-resolves a fresh publicToken for it. Valid for
 * status='active' (paid promptly is impossible here since renewal Orders
 * are only ever created once the period has already ended, but the
 * window between Order-creation and the grace job noticing is real) and
 * 'grace_period' (the normal case — same outstanding Order, still
 * payable through the end of the grace window).
 */
async function payRenewal(tenantId, clientId) {
  const existing = await clientSubscriptionModel.findByClient(clientId);
  if (!existing) throw httpError("No subscription found for this client.", 404, "NO_SUBSCRIPTION");
  if (!["active", "grace_period"].includes(existing.status) || !existing.pending_razorpay_order_id) {
    throw httpError("No renewal payment is currently due.", 400, "NO_RENEWAL_DUE");
  }
  if (existing.pending_upgrade_plan_id) {
    // Step 10: the outstanding Order belongs to an UPGRADE, not a
    // renewal — these are mutually exclusive uses of the single
    // pending_razorpay_order_id column. retryPayment (not payRenewal) is
    // the correct call for an outstanding upgrade payment.
    throw httpError("This subscription has a pending upgrade payment, not a renewal. Use retry payment instead.", 400, "PENDING_ORDER_IS_UPGRADE");
  }

  const tokenInfo = await agencyRazorpayConnectService.getValidAccessToken(tenantId);
  if (!tokenInfo?.publicToken) {
    throw httpError(
      "Your agency's Razorpay connection needs to be reconnected. Ask your agency administrator to reconnect it.",
      400,
      "AGENCY_RAZORPAY_NOT_CONNECTED"
    );
  }

  const plan = await clientSubscriptionPlanModel.findById(tenantId, existing.plan_id);
  if (!plan) throw httpError("Plan not found.", 404);

  return {
    subscription: serialize(existing),
    plan: serializePlanSummary(plan),
    checkout: {
      razorpayOrderId: existing.pending_razorpay_order_id,
      // The already-snapshotted renewal price/currency, never the live
      // plan — same "IMPORTANT SNAPSHOT RULE" as chooseSubscription/
      // retryPayment/the renewal job itself.
      amount: existing.current_price,
      currency: plan.currency,
      publicToken: tokenInfo.publicToken,
    },
  };
}

/**
 * Step 10 — records/replaces a requested downgrade for the NEXT renewal.
 * No payment, no Order, no change to the currently-running (already-paid-
 * for) period — only next_plan_id changes. "Lower" is defined using the
 * SAME rule as upgrade's "higher": target plan price vs the subscription's
 * own applicable price (current_price, the snapshot — never the live
 * current plan price; an Agency Admin's own plan edits must not silently
 * change what counts as a downgrade either).
 *
 * "If next_plan_id is already set: safely replace... OR reject — use the
 * simplest consistent behavior" — this always REPLACES: a later request is
 * always the Client's most current intent, and there is no side effect (no
 * payment, no Order) from an earlier request to undo first.
 */
async function requestDowngrade(tenantId, clientId, body) {
  const { planId } = validateChoosePlan(body);

  const existing = await clientSubscriptionModel.findByClient(clientId);
  if (!existing) throw httpError("No subscription found for this client.", 404, "NO_SUBSCRIPTION");
  if (!["active", "grace_period"].includes(existing.status)) {
    throw httpError(`Cannot request a downgrade while the subscription is '${existing.status}'.`, 400, "NOT_DOWNGRADABLE");
  }

  const targetPlan = await clientSubscriptionPlanModel.findById(tenantId, planId);
  if (!targetPlan) throw httpError("Plan not found.", 404);
  if (!targetPlan.is_active) throw httpError("This plan is not available.", 400, "PLAN_NOT_AVAILABLE");

  const currentPlan = await clientSubscriptionPlanModel.findById(tenantId, existing.plan_id);
  const currentApplicablePrice = existing.current_price ?? currentPlan?.price ?? null;
  if (currentApplicablePrice === null) throw httpError("Could not determine the current plan's price.", 500);
  if (targetPlan.price >= currentApplicablePrice) {
    throw httpError("The selected plan is not lower-priced than your current plan.", 400, "NOT_A_DOWNGRADE");
  }

  const updated = await clientSubscriptionModel.setNextPlan(tenantId, clientId, targetPlan.id);
  if (!updated) {
    // The row's status changed between the read above and this write
    // (e.g. a renewal/expiry job or a webhook ran in between) — refuse
    // rather than silently apply a downgrade against a state that no
    // longer matches what was validated.
    throw httpError("Your subscription's status changed. Please refresh and try again.", 409, "DOWNGRADE_STATE_CHANGED");
  }

  return { subscription: serialize(updated), nextPlan: serializePlanSummary(targetPlan) };
}

/**
 * Step 10 — prorated upgrade amount. Pure, side-effect-free — implements
 * exactly the given formula, nothing more. Used by both requestUpgrade
 * (first attempt) and retryUpgradePayment (recomputed fresh against "now"
 * at retry time — never reused from a stale first attempt).
 *
 * All amounts are integer smallest-currency-units (paise/cents) — no
 * floating-point money math anywhere. cycle_length/remaining_days are
 * whole calendar days (Math.round of a millisecond difference divided by
 * a day — safe here because current_period_start/end/now are always
 * exact Date instants, never fractional-day business quantities).
 * unused_credit uses Math.round (round-half-away-from-zero on the exact
 * midpoint, JS's standard behavior) — the ONE rounding step in the whole
 * formula, applied once, not compounded. amount_due is floored at 0 (a
 * credit can never make the amount negative).
 */
function computeUpgradeProration({ currentPrice, currentPeriodStart, currentPeriodEnd, targetPlanPrice, now = new Date() }) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const cycleLengthDays = Math.round((new Date(currentPeriodEnd).getTime() - new Date(currentPeriodStart).getTime()) / MS_PER_DAY);
  const remainingDays = Math.round((new Date(currentPeriodEnd).getTime() - new Date(now).getTime()) / MS_PER_DAY);
  if (cycleLengthDays <= 0) throw httpError("Cannot calculate proration: invalid billing period.", 500);

  const clampedRemainingDays = Math.max(0, Math.min(remainingDays, cycleLengthDays));
  const unusedCredit = Math.round((currentPrice * clampedRemainingDays) / cycleLengthDays);
  const amountDue = Math.max(targetPlanPrice - unusedCredit, 0);

  return { cycleLengthDays, remainingDays: clampedRemainingDays, unusedCredit, amountDue };
}

/**
 * Step 10 — Client plan upgrade. Immediate, prorated, but never active
 * until the webhook confirms payment (this file's own "browser success
 * callback must never activate the subscription" discipline, unchanged
 * since Step 8B). Order of operations mirrors chooseSubscription/
 * retryPayment: validate -> claim the pending-order slot (optimistic
 * commit, no held transaction across the external call) -> create the
 * Razorpay Order -> commit the claim. plan_id/current_price are NEVER
 * touched here — only activateUpgrade (webhook-confirmed) changes them.
 *
 * "Higher" is defined the same way as downgrade's "lower": target plan
 * price vs the subscription's own applicable price (current_price, the
 * snapshot — never the live current plan price).
 */
async function requestUpgrade(tenantId, clientId, body) {
  const { planId } = validateChoosePlan(body);

  const existing = await clientSubscriptionModel.findByClient(clientId);
  if (!existing) throw httpError("No subscription found for this client.", 404, "NO_SUBSCRIPTION");
  if (existing.status !== "active") {
    throw httpError(`Cannot request an upgrade while the subscription is '${existing.status}'.`, 400, "NOT_UPGRADABLE");
  }
  if (existing.pending_razorpay_order_id) {
    // Covers BOTH "a renewal Order is already pending" (status='active'
    // with pending_razorpay_order_id set only ever means that, since
    // grace_period always has one too but is excluded by the status check
    // above) and "an upgrade is already pending" — either way, "confirm
    // there is no existing pending payment Order" before starting a new one.
    throw httpError(
      "A payment is already pending for this subscription. Please complete or wait for it to resolve first.",
      409,
      "PENDING_ORDER_EXISTS"
    );
  }

  const targetPlan = await clientSubscriptionPlanModel.findById(tenantId, planId);
  if (!targetPlan) throw httpError("Plan not found.", 404);
  if (!targetPlan.is_active) throw httpError("This plan is not available.", 400, "PLAN_NOT_AVAILABLE");

  const currentPlan = await clientSubscriptionPlanModel.findById(tenantId, existing.plan_id);
  const currentApplicablePrice = existing.current_price ?? currentPlan?.price ?? null;
  if (currentApplicablePrice === null) throw httpError("Could not determine the current plan's price.", 500);
  if (targetPlan.price <= currentApplicablePrice) {
    throw httpError("The selected plan is not higher-priced than your current plan.", 400, "NOT_AN_UPGRADE");
  }

  // Step 8E's readiness gate — fails fast, before any DB write, exactly
  // like chooseSubscription.
  await agencyRazorpayConnectService.requireClientPaymentsReady(tenantId);

  const { amountDue } = computeUpgradeProration({
    currentPrice: currentApplicablePrice,
    currentPeriodStart: existing.current_period_start,
    currentPeriodEnd: existing.current_period_end,
    targetPlanPrice: targetPlan.price,
  });

  if (amountDue === 0) {
    // Step 10's own explicit instruction: no official Razorpay
    // documentation was found confirming a zero-value Order is
    // supported — never guess/invent that behavior. This exact edge case
    // (existing credit fully covers the target plan's price) needs a
    // deliberate business decision (e.g. apply the upgrade immediately
    // with no Order, since nothing is owed) rather than being silently
    // handled here.
    throw httpError(
      "This upgrade has no additional amount due right now — your existing plan credit fully covers it. This case needs a manual decision; contact your agency administrator.",
      409,
      "UPGRADE_ZERO_AMOUNT_UNSUPPORTED"
    );
  }

  const tokenInfo = await agencyRazorpayConnectService.getValidAccessToken(tenantId);
  if (!tokenInfo?.publicToken) {
    throw httpError(
      "Your agency's Razorpay connection needs to be reconnected. Ask your agency administrator to reconnect it.",
      400,
      "AGENCY_RAZORPAY_NOT_CONNECTED"
    );
  }

  let order;
  try {
    order = await razorpayOrderClient.createOrder({
      accessToken: tokenInfo.accessToken,
      amount: amountDue,
      currency: targetPlan.currency,
      receipt: `client-${clientId}-upgrade-${Date.now()}`,
      notes: {
        crm_tenant_id: String(tenantId),
        crm_client_id: String(clientId),
        crm_upgrade_to_plan_id: String(targetPlan.id),
        crm_upgrade_from_plan_id: String(existing.plan_id),
      },
    });
  } catch (err) {
    // Nothing local was written yet — safe to just report the failure, no
    // compensation needed (unlike chooseSubscription, nothing was
    // pre-claimed before this call).
    throw err;
  }

  const claimed = await clientSubscriptionModel.claimUpgradeOrder(tenantId, clientId, {
    razorpayOrderId: order.id,
    pendingUpgradePlanId: targetPlan.id,
  });
  if (!claimed) {
    // Lost an optimistic-concurrency race (a concurrent upgrade request,
    // or a renewal/cancellation/grace transition, claimed/changed the row
    // first) — the Order just created sits unpaid and unreferenced on
    // Razorpay's side, the same accepted tradeoff documented throughout
    // this file's other claim* functions.
    throw httpError("Your subscription's status changed while upgrading. Please refresh and try again.", 409, "UPGRADE_STATE_CHANGED");
  }

  return {
    subscription: serialize(claimed),
    plan: serializePlanSummary(targetPlan),
    // Shown so the frontend can display the exact amount BEFORE opening
    // Checkout — this is the authoritative, backend-computed amount;
    // Checkout itself is opened against `checkout.amount` (the Order's
    // own confirmed amount), never a frontend-supplied value.
    proration: { amountDue },
    checkout: { razorpayOrderId: order.id, amount: order.amount, currency: order.currency, publicToken: tokenInfo.publicToken },
  };
}

/**
 * "Cancellation disables auto-renewal... current paid period continues"
 * (Part H) — a LOCAL state change only, for two independent reasons: (a)
 * no real Razorpay subscription can exist yet under this step's boundary,
 * so there is nothing on Razorpay's side to cancel; and (b) even once one
 * does exist, cancelling it is itself a Subscriptions-API operation on the
 * connected account, which falls under the exact same unverified boundary
 * documented at the top of this file — a verified Razorpay call will need
 * to be added here alongside the local update once that's confirmed, not
 * substituted with an unverified one now.
 */
async function cancelSubscription(clientId) {
  const existing = await clientSubscriptionModel.findByClient(clientId);
  if (!existing) throw httpError("No subscription found for this client.", 404, "NO_SUBSCRIPTION");
  if (!existing.auto_renew) throw httpError("This subscription is already set to not renew.", 400, "ALREADY_NOT_RENEWING");

  const updated = await clientSubscriptionModel.setAutoRenewFalse(clientId);
  return serialize(updated);
}

module.exports = {
  listActivePlans,
  getCurrentSubscription,
  chooseSubscription,
  retryPayment,
  payRenewal,
  requestDowngrade,
  requestUpgrade,
  cancelSubscription,
  serialize,
  serializePlanSummary,
  computeUpgradeProration,
};
