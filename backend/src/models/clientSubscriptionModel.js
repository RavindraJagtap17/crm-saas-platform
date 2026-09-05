const pool = require("../config/db");

// One current subscription per Client (uq_client_subscriptions_client,
// migration 044), updated in place across its lifecycle — mirrors
// agencySubscriptionModel.js one level down. tenant_id is carried on every
// write for the composite-FK ownership guarantees migration 044 already
// establishes (fk_client_subscriptions_tenant_client /
// fk_client_subscriptions_tenant_plan) — never trusted from a request,
// always the caller's own req.tenantId.
// next_plan_id/pending_razorpay_order_id/current_price/current_period_start
// are migration 048's Orders-billing additions — included here so every
// read (including the FOR UPDATE lock read Step 8B relies on) sees them.
// pending_upgrade_plan_id is migration 050's Step 10 addition — see
// claimUpgradeOrder/activateUpgrade below.
const COLUMNS = `
  id, tenant_id, client_id, plan_id, next_plan_id, razorpay_subscription_id, razorpay_customer_id,
  pending_razorpay_order_id, pending_upgrade_plan_id, status, current_period_end, grace_period_ends_at,
  current_price, current_period_start, auto_renew, created_at, updated_at
`;

// conn is optional and trailing (matches userModel.findById's own
// convention, Step 4) — required when reading back a row inside a
// still-open transaction (create/restartWithPlan below), since a read via
// the plain pool cannot see another connection's uncommitted write.
async function findByClient(clientId, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM client_subscriptions WHERE client_id = ? LIMIT 1`, [clientId]);
  return rows[0] || null;
}

// Reserved for a future verified webhook-reconciliation path (see
// clientBillingService.js's header comment) — not called anywhere in this
// step.
async function findByRazorpaySubscriptionId(razorpaySubscriptionId, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM client_subscriptions WHERE razorpay_subscription_id = ? LIMIT 1`, [
    razorpaySubscriptionId,
  ]);
  return rows[0] || null;
}

// conn is optional (falls back to pool) matching this codebase's
// established convention — Step 8B's chooseSubscription passes the open
// transaction connection so this INSERT participates in the row-lock-based
// claim (see findByClientForUpdate below); every other/older caller shape
// (none currently) would still work unchanged with conn omitted.
async function create(conn, tenantId, clientId, planId) {
  const runner = conn || pool;
  await runner.query(`INSERT INTO client_subscriptions (tenant_id, client_id, plan_id, status) VALUES (?, ?, ?, 'pending')`, [
    tenantId,
    clientId,
    planId,
  ]);
  return findByClient(clientId, conn);
}

// Re-selecting a plan after the previous subscription cycle fully ended
// (cancelled/expired) reuses the SAME row rather than inserting a new one
// — UNIQUE(client_id) on this table forces exactly that, matching how
// agencySubscriptionModel/subscriptionModel are likewise "one row per
// owner, updated in place" rather than one row per attempt. Every
// lifecycle field resets to a clean starting state, including the Step 8B
// Orders-billing fields (pending_razorpay_order_id/current_price/
// current_period_start) added by migration 048.
async function restartWithPlan(conn, tenantId, clientId, planId) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE client_subscriptions SET
       plan_id = ?, next_plan_id = NULL, status = 'pending', razorpay_subscription_id = NULL, razorpay_customer_id = NULL,
       pending_razorpay_order_id = NULL, pending_upgrade_plan_id = NULL, current_period_end = NULL, current_period_start = NULL,
       current_price = NULL, grace_period_ends_at = NULL, auto_renew = TRUE
     WHERE client_id = ? AND tenant_id = ?`,
    [planId, clientId, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findByClient(clientId, conn);
}

/**
 * Step 8B — the race-closing primitive for "choose a plan": locks any
 * existing row for this client (or confirms none exists) inside the
 * caller's transaction. A second, concurrent "choose a plan" request for
 * the same client blocks on this SELECT ... FOR UPDATE until the first
 * request's transaction commits or rolls back, closing the double-click/
 * duplicate-Order race window — the actual Razorpay Order-creation call
 * happens OUTSIDE this transaction (see clientBillingService.js), matching
 * this codebase's established "never hold a transaction across an
 * external API call" discipline.
 */
async function findByClientForUpdate(conn, clientId) {
  const [rows] = await conn.query(`SELECT ${COLUMNS} FROM client_subscriptions WHERE client_id = ? FOR UPDATE`, [clientId]);
  return rows[0] || null;
}

/**
 * Step 8D — the authoritative webhook->subscription resolution path:
 * pending_razorpay_order_id -> client_subscriptions -> client_id/tenant_id
 * -> client_subscription_plans. This is the ONLY way a webhook may ever
 * resolve which subscription a payment belongs to — never a client_id/
 * tenant_id read from the (even signature-verified) payload, which never
 * carries one. UNIQUE(pending_razorpay_order_id) (migration 048)
 * guarantees at most one match.
 */
async function findByPendingOrderId(razorpayOrderId, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM client_subscriptions WHERE pending_razorpay_order_id = ? LIMIT 1`, [
    razorpayOrderId,
  ]);
  return rows[0] || null;
}

/**
 * PENDING -> ACTIVE, the one transition this step implements. Scoped by
 * primary key id (the caller has already resolved and ownership-checked
 * the exact row via findByPendingOrderId) — clears
 * pending_razorpay_order_id (the order has now been consumed) and
 * grace_period_ends_at (a fresh period has no grace pending), and commits
 * the confirmed price/period. `id` is included in the WHERE clause
 * defensively so this can never affect a row concurrently modified in a
 * way that changed its id in between (impossible in practice, but matches
 * this codebase's "never assume, always scope the write" discipline).
 */
async function activate(conn, subscriptionId, { currentPrice, currentPeriodStart, currentPeriodEnd }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE client_subscriptions SET
       status = 'active',
       current_price = ?,
       current_period_start = ?,
       current_period_end = ?,
       grace_period_ends_at = NULL,
       pending_razorpay_order_id = NULL
     WHERE id = ?`,
    [currentPrice, currentPeriodStart, currentPeriodEnd, subscriptionId]
  );
  return result.affectedRows > 0;
}

/**
 * Step 8E — failed initial-payment retry: replaces a subscription's
 * pending_razorpay_order_id with a freshly-created Order, but ONLY if
 * nothing about the row has changed since the caller read it
 * (status='pending' AND pending_razorpay_order_id still equals
 * `previousOrderId`) — an optimistic-concurrency guard against a race
 * between a webhook activating the OLD order (or a second, concurrent
 * retry) and this write. Returns null when the guard fails, which the
 * caller treats as "state changed underneath us, refuse and report" rather
 * than silently overwriting a subscription a webhook may have just
 * activated.
 */
async function replacePendingOrder(tenantId, clientId, { previousOrderId, razorpayOrderId, currentPrice }) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions SET pending_razorpay_order_id = ?, current_price = ?
     WHERE client_id = ? AND tenant_id = ? AND status = 'pending' AND pending_razorpay_order_id = ?`,
    [razorpayOrderId, currentPrice, clientId, tenantId, previousOrderId]
  );
  if (result.affectedRows === 0) return null;
  return findByClient(clientId);
}

// Commits a confirmed Razorpay Order onto the (already-claimed) pending
// row — the ONLY write that happens after the external call succeeds.
async function setPendingOrder(tenantId, clientId, { razorpayOrderId, currentPrice }) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions SET pending_razorpay_order_id = ?, current_price = ? WHERE client_id = ? AND tenant_id = ?`,
    [razorpayOrderId, currentPrice, clientId, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findByClient(clientId);
}

// Compensating rollback for a failed Order-creation attempt on a REUSED
// (restart) row — restores every field the claim step may have
// overwritten back to its exact prior value, so "Order creation failed"
// never leaves a half-reset subscription behind. `priorRow` is the raw row
// read (and locked) by findByClientForUpdate before the claim overwrote it.
async function restoreRow(tenantId, clientId, priorRow) {
  await pool.query(
    `UPDATE client_subscriptions SET
       plan_id = ?, next_plan_id = ?, status = ?, razorpay_subscription_id = ?, razorpay_customer_id = ?,
       pending_razorpay_order_id = ?, pending_upgrade_plan_id = ?, current_period_end = ?, current_period_start = ?,
       current_price = ?, grace_period_ends_at = ?, auto_renew = ?
     WHERE client_id = ? AND tenant_id = ?`,
    [
      priorRow.plan_id,
      priorRow.next_plan_id,
      priorRow.status,
      priorRow.razorpay_subscription_id,
      priorRow.razorpay_customer_id,
      priorRow.pending_razorpay_order_id,
      priorRow.pending_upgrade_plan_id,
      priorRow.current_period_end,
      priorRow.current_period_start,
      priorRow.current_price,
      priorRow.grace_period_ends_at,
      priorRow.auto_renew,
      clientId,
      tenantId,
    ]
  );
}

// Compensating rollback for a failed Order-creation attempt on a
// NEWLY-INSERTED row — nothing else can reference it yet, so a hard delete
// is safe and correct (this is not the "never destructively delete
// subscription history" case — there is no history yet, only an aborted
// attempt that never had a real Order behind it).
async function deleteById(id) {
  await pool.query(`DELETE FROM client_subscriptions WHERE id = ?`, [id]);
}

async function setAutoRenewFalse(clientId) {
  const [result] = await pool.query(`UPDATE client_subscriptions SET auto_renew = FALSE WHERE client_id = ?`, [clientId]);
  if (result.affectedRows === 0) return null;
  return findByClient(clientId);
}

/**
 * Step 9B — renewal Order creation eligibility (see
 * clientRenewalService.runRenewalOrderCreation): active, still auto-
 * renewing, past its current period, and with no outstanding Order
 * already pending against it. `now` is passed in (not computed here) so
 * a single job run uses one consistent instant across its whole batch.
 */
async function listDueForRenewal(now) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM client_subscriptions
     WHERE status = 'active' AND auto_renew = TRUE AND current_period_end <= ? AND pending_razorpay_order_id IS NULL`,
    [now]
  );
  return rows;
}

/**
 * Step 9B — commits a freshly-created renewal Order, but ONLY if the
 * subscription is STILL exactly in the state that made it eligible when
 * it was read (status='active', auto_renew still true, no OTHER pending
 * order already claimed in the meantime). This is the same optimistic-
 * concurrency shape as replacePendingOrder above, applied here because a
 * renewal job — like chooseSubscription/retryPayment — must create the
 * Razorpay Order OUTSIDE any DB transaction (never hold a transaction
 * across an external API call), so there is no row lock protecting this
 * window. If the guard fails (0 rows affected), the Order that was just
 * created is simply never referenced locally and sits unpaid, harmless,
 * on Razorpay's side — the exact same accepted tradeoff already
 * documented on replacePendingOrder/retryPayment.
 */
async function claimRenewalOrder(tenantId, clientId, { razorpayOrderId, currentPrice }) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions SET pending_razorpay_order_id = ?, current_price = ?
     WHERE client_id = ? AND tenant_id = ? AND status = 'active' AND auto_renew = TRUE AND pending_razorpay_order_id IS NULL`,
    [razorpayOrderId, currentPrice, clientId, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findByClient(clientId);
}

/**
 * Step 9B — renewal payment success: ACTIVE or GRACE_PERIOD -> ACTIVE,
 * the counterpart to activate() (which only ever handles the initial
 * PENDING -> ACTIVE transition). Guarded by both the expected status set
 * AND the exact Order id being paid — closes the race against a
 * concurrent client-grace-expiry run: if grace-expiry's bulk UPDATE won
 * that race first (status is now 'expired'), this guard fails (0 rows),
 * and the caller (clientPaymentWebhookService) records the payment for
 * reconciliation but does NOT reactivate — never overwrites a later,
 * independently-reached terminal state backward into 'active'.
 *
 * Step 10 — `planId` is ALWAYS supplied by the caller (never omitted):
 * for a plain renewal the caller passes the subscription's own existing
 * plan_id unchanged; for a renewal that applies a previously-requested
 * downgrade (next_plan_id was set), the caller passes next_plan_id. This
 * one function safely covers BOTH cases — next_plan_id is unconditionally
 * cleared here (a no-op UPDATE when it was already NULL), so a downgrade
 * can never remain "pending" past the renewal that applies it, and a
 * plain renewal can never accidentally leave a stale next_plan_id behind
 * either.
 */
async function activateRenewal(conn, subscriptionId, { planId, currentPrice, currentPeriodStart, currentPeriodEnd, expectedOrderId }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE client_subscriptions SET
       status = 'active',
       plan_id = ?,
       next_plan_id = NULL,
       current_price = ?,
       current_period_start = ?,
       current_period_end = ?,
       grace_period_ends_at = NULL,
       pending_razorpay_order_id = NULL
     WHERE id = ? AND status IN ('active', 'grace_period') AND pending_razorpay_order_id = ?`,
    [planId, currentPrice, currentPeriodStart, currentPeriodEnd, subscriptionId, expectedOrderId]
  );
  return result.affectedRows > 0;
}

/**
 * Step 10 — claims the one-pending-order slot for an UPGRADE Order,
 * exactly mirroring claimRenewalOrder's optimistic-concurrency shape
 * (same reason: the Razorpay Order is created OUTSIDE any transaction, so
 * this guarded UPDATE is what actually prevents two concurrent upgrade
 * requests — or an upgrade racing a renewal/retry — from both claiming
 * the slot). Only ever matches 'active' with NO existing pending order —
 * grace_period always HAS one (that's what makes it grace_period), so
 * this guard structurally already excludes it; "confirm there is no
 * existing pending payment Order" (Step 10's own precondition) is
 * enforced here, not just checked earlier in the service layer.
 * plan_id/current_price are deliberately NOT touched here — only
 * pending_razorpay_order_id and pending_upgrade_plan_id change; the
 * actual plan change happens exclusively in activateUpgrade, on confirmed
 * payment.
 */
async function claimUpgradeOrder(tenantId, clientId, { razorpayOrderId, pendingUpgradePlanId }) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions SET pending_razorpay_order_id = ?, pending_upgrade_plan_id = ?
     WHERE client_id = ? AND tenant_id = ? AND status = 'active' AND pending_razorpay_order_id IS NULL`,
    [razorpayOrderId, pendingUpgradePlanId, clientId, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findByClient(clientId);
}

/**
 * Step 10 — replaces a failed/abandoned UPGRADE Order with a freshly-
 * created one for the SAME target plan (the proration amount is
 * recomputed by the caller against "now" at retry time, since the
 * original amount is now stale) — the retryPayment counterpart to
 * replacePendingOrder, guarded the same way: only applies if the row is
 * still exactly as read (status='active', same previousOrderId, same
 * pending_upgrade_plan_id still pointing at the target being retried).
 */
async function replaceUpgradeOrder(tenantId, clientId, { previousOrderId, razorpayOrderId, pendingUpgradePlanId }) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions SET pending_razorpay_order_id = ?
     WHERE client_id = ? AND tenant_id = ? AND status = 'active' AND pending_razorpay_order_id = ? AND pending_upgrade_plan_id = ?`,
    [razorpayOrderId, clientId, tenantId, previousOrderId, pendingUpgradePlanId]
  );
  if (result.affectedRows === 0) return null;
  return findByClient(clientId);
}

/**
 * Step 10 — the ONLY transition that ever changes plan_id/current_price
 * for an upgrade: fires exclusively on confirmed webhook payment. Never
 * touches current_period_start/current_period_end ("the upgrade must not
 * extend the billing period") or status (an upgrade only ever starts from
 * 'active' and stays 'active'). Guarded by pending_upgrade_plan_id
 * matching the plan actually being activated, in addition to the Order
 * id — closes the same class of race activateRenewal already closes
 * against grace/cancellation-expiry (though neither of those can affect
 * an 'active' row with no next_plan_id-driven transition, this guard
 * costs nothing and matches this codebase's "never assume, always scope
 * the write" discipline).
 */
async function activateUpgrade(conn, subscriptionId, { planId, currentPrice, expectedOrderId }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE client_subscriptions SET
       plan_id = ?,
       current_price = ?,
       pending_razorpay_order_id = NULL,
       pending_upgrade_plan_id = NULL
     WHERE id = ? AND status = 'active' AND pending_razorpay_order_id = ? AND pending_upgrade_plan_id = ?`,
    [planId, currentPrice, subscriptionId, expectedOrderId, planId]
  );
  return result.affectedRows > 0;
}

// Step 10 — clears a stale pending-upgrade claim without activating
// anything, used by retryPayment when the upgrade's target plan has
// since been deactivated (mirrors the downgrade-target-deactivated
// principle: never silently charge for/apply a dead plan). Leaves
// plan_id/current_price/status untouched — the Client remains on their
// current plan and must choose a fresh upgrade target.
async function clearPendingUpgrade(tenantId, clientId, previousOrderId) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions SET pending_razorpay_order_id = NULL, pending_upgrade_plan_id = NULL
     WHERE client_id = ? AND tenant_id = ? AND status = 'active' AND pending_razorpay_order_id = ?`,
    [clientId, tenantId, previousOrderId]
  );
  if (result.affectedRows === 0) return null;
  return findByClient(clientId);
}

/**
 * Step 9B — client-renewal-grace: ACTIVE -> GRACE_PERIOD for any
 * subscription whose renewal Order is still outstanding past its own
 * current_period_end. A single atomic bulk UPDATE (joined against
 * client_subscription_plans purely to read billing_cycle) rather than a
 * per-row SELECT+UPDATE loop — this is a pure local state transition
 * (no external Razorpay call), so there is no reason not to do it as one
 * statement, and doing so removes any read-then-write race window
 * entirely (MySQL evaluates the WHERE/JOIN against committed state at
 * execution time as part of the single statement).
 *
 * grace_period_ends_at is anchored to the subscription's OWN
 * current_period_end (+3 days monthly / +7 days yearly), never to `now`
 * — this is what "do not reset the deadline repeatedly" means in
 * practice: because this UPDATE only ever matches rows still in
 * status='active', a subscription this job has already moved to
 * 'grace_period' can never be matched by it again, so the deadline is
 * computed exactly once, at the moment of the transition, and is never
 * recomputed on a later run.
 *
 * Step 10: EXCLUDES any row with pending_upgrade_plan_id set — an
 * outstanding UPGRADE Order is not an unpaid renewal, and must never be
 * mistaken for one just because current_period_end happens to have
 * passed while that upgrade payment is still in flight (a real,
 * reachable timing edge case, not hypothetical).
 */
async function bulkEnterGracePeriod(now) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions cs
     JOIN client_subscription_plans csp ON csp.id = cs.plan_id AND csp.tenant_id = cs.tenant_id
     SET cs.status = 'grace_period',
         cs.grace_period_ends_at = DATE_ADD(cs.current_period_end, INTERVAL IF(csp.billing_cycle = 'yearly', 7, 3) DAY)
     WHERE cs.status = 'active' AND cs.pending_razorpay_order_id IS NOT NULL
       AND cs.pending_upgrade_plan_id IS NULL AND cs.current_period_end <= ?`,
    [now]
  );
  return result.affectedRows;
}

// Step 9B — client-grace-expiry: GRACE_PERIOD -> EXPIRED once
// grace_period_ends_at has passed. Deliberately does NOT clear
// pending_razorpay_order_id or delete any payment history — the stale
// Order id is left in place on purpose so a LATE-arriving payment
// webhook for it can still be traced back to this exact subscription for
// safe recording/flagging (see clientPaymentWebhookService's "late
// payment after expired" handling) rather than becoming an unresolvable
// "unknown_order".
async function bulkExpireGracePeriod(now) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions SET status = 'expired' WHERE status = 'grace_period' AND grace_period_ends_at < ?`,
    [now]
  );
  return result.affectedRows;
}

// Step 9B — client-cancellation-expiry: ACTIVE + auto_renew=FALSE ->
// CANCELLED once the already-paid-for current period ends. Only ever
// matches 'active' rows, so a subscription already in grace_period when
// cancellation was requested is left exactly as-is (still governed solely
// by client-grace-expiry) — no new/second cancellation-from-grace
// transition is invented here.
async function bulkCancelAtPeriodEnd(now) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions SET status = 'cancelled' WHERE status = 'active' AND auto_renew = FALSE AND current_period_end <= ?`,
    [now]
  );
  return result.affectedRows;
}

/**
 * Step 10 — records/replaces a requested downgrade. Guarded to only ever
 * affect a row currently 'active' or 'grace_period' — a subscription that
 * isn't really running (pending/cancelled/expired) has nothing to
 * downgrade FROM. Simplest-consistent "replace" semantics: calling this
 * again with a different plan just overwrites next_plan_id — no separate
 * reject-if-already-set path, since a later request is always the
 * Client's most current intent and there is no payment/side-effect to
 * undo by changing their mind again before the renewal that applies it.
 * Never touches plan_id/current_price/current_period_end/auto_renew/
 * pending_razorpay_order_id — a downgrade REQUEST changes nothing about
 * the currently-running, already-paid-for period.
 */
async function setNextPlan(tenantId, clientId, nextPlanId) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions SET next_plan_id = ?
     WHERE client_id = ? AND tenant_id = ? AND status IN ('active', 'grace_period')`,
    [nextPlanId, clientId, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findByClient(clientId);
}

/**
 * Step 10 — "downgrade target became inactive before renewal": a bulk,
 * atomic ACTIVE -> EXPIRED transition (same "no external call, do it as
 * one statement" reasoning as bulkEnterGracePeriod) for any subscription
 * that is due for renewal, still auto-renewing, has NO renewal Order
 * outstanding yet, AND whose next_plan_id no longer points at an active
 * plan (LEFT JOIN + NULL/is_active=FALSE check covers both "the plan row
 * is gone" — impossible under the RESTRICT FK, kept defensively — and
 * "the plan was deactivated"). Runs BEFORE listDueForRenewal/Order
 * creation on every client-renewal-orders tick, so these rows are never
 * offered a renewal Order at all: "do not charge for the deactivated
 * downgrade target."
 *
 * Reuses the EXISTING 'expired' status rather than inventing a new one —
 * deliberately: from the Client's perspective this is behaviorally
 * identical to "the paid period ended with no valid way to renew" (CRM
 * locks via the same requireActiveTenant gating, billing page stays
 * reachable, data is retained, and the existing chooseSubscription/
 * restartWithPlan flow is exactly "Client must choose an active plan").
 * next_plan_id is cleared since the dead target is no longer actionable.
 */
async function bulkExpireForInactiveDowngradeTarget(now) {
  const [result] = await pool.query(
    `UPDATE client_subscriptions cs
     LEFT JOIN client_subscription_plans np ON np.id = cs.next_plan_id AND np.tenant_id = cs.tenant_id
     SET cs.status = 'expired', cs.next_plan_id = NULL
     WHERE cs.status = 'active' AND cs.auto_renew = TRUE AND cs.pending_razorpay_order_id IS NULL
       AND cs.current_period_end <= ? AND cs.next_plan_id IS NOT NULL
       AND (np.id IS NULL OR np.is_active = FALSE)`,
    [now]
  );
  return result.affectedRows;
}

// Reserved for a future verified webhook-reconciliation path once Client
// Razorpay Plan/Subscription creation is confirmed (see
// clientBillingService.js's header comment). Not wired to any route in
// this step — written now only because migration 044 already models
// these exact fields (status/current_period_end/grace_period_ends_at) and
// this shape is unlikely to change once the real mechanism is confirmed;
// kept here as a tested, ready-to-use building block rather than
// speculative dead code with no test coverage.
async function applyWebhookState(conn, razorpaySubscriptionId, { status, currentPeriodEnd, gracePeriodEndsAt, razorpayCustomerId }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE client_subscriptions SET
       status = ?,
       current_period_end = COALESCE(?, current_period_end),
       grace_period_ends_at = ?,
       razorpay_customer_id = COALESCE(?, razorpay_customer_id)
     WHERE razorpay_subscription_id = ?`,
    [status, currentPeriodEnd ?? null, gracePeriodEndsAt ?? null, razorpayCustomerId ?? null, razorpaySubscriptionId]
  );
  return result.affectedRows > 0;
}

module.exports = {
  findByClient,
  findByRazorpaySubscriptionId,
  findByClientForUpdate,
  findByPendingOrderId,
  create,
  restartWithPlan,
  activate,
  setAutoRenewFalse,
  setPendingOrder,
  replacePendingOrder,
  restoreRow,
  deleteById,
  applyWebhookState,
  listDueForRenewal,
  claimRenewalOrder,
  activateRenewal,
  bulkEnterGracePeriod,
  bulkExpireGracePeriod,
  bulkCancelAtPeriodEnd,
  setNextPlan,
  bulkExpireForInactiveDowngradeTarget,
  claimUpgradeOrder,
  replaceUpgradeOrder,
  activateUpgrade,
  clearPendingUpgrade,
};
