const pool = require("../config/db");

const COLUMNS = `
  id, tenant_id, plan_id, razorpay_subscription_id, razorpay_customer_id,
  status, current_period_end, grace_period_ends_at, auto_renew, created_at, updated_at
`;

// New-business-model counterpart to subscriptionModel.js, scoped to the
// new agency_subscriptions table (migration 042) instead of the old
// subscriptions table — see billingService.js for why these are kept as
// two fully separate tables/models rather than one modified in place.

async function findByTenant(tenantId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM agency_subscriptions WHERE tenant_id = ? LIMIT 1`, [tenantId]);
  return rows[0] || null;
}

async function findByRazorpaySubscriptionId(razorpaySubscriptionId, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM agency_subscriptions WHERE razorpay_subscription_id = ? LIMIT 1`, [
    razorpaySubscriptionId,
  ]);
  return rows[0] || null;
}

// One row per tenant (uq_agency_subscriptions_tenant) — same "create is a
// programming error if one already exists" contract as subscriptionModel.create;
// billingService.initiateAgencySubscription is expected to have already
// checked via findByTenant.
async function create(conn, { tenantId, planId, razorpaySubscriptionId, razorpayCustomerId, status }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT INTO agency_subscriptions (tenant_id, plan_id, razorpay_subscription_id, razorpay_customer_id, status)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, planId, razorpaySubscriptionId, razorpayCustomerId, status]
  );
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM agency_subscriptions WHERE id = ?`, [result.insertId]);
  return rows[0];
}

// Webhook-reconciliation write path — every field set from webhook-
// confirmed Razorpay state. Unlike subscriptionModel.applyWebhookState,
// gracePeriodEndsAt is NOT COALESCE'd against the existing value: the
// caller (razorpayWebhookService) always computes and passes the full
// final value itself (a Date to set/keep it, or null to clear it) after
// reading the row's current state, since "keep the existing deadline
// unless just entering grace_period" is business logic, not something a
// generic SQL COALESCE can express correctly here.
async function applyWebhookState(conn, razorpaySubscriptionId, { status, currentPeriodEnd, gracePeriodEndsAt, razorpayCustomerId }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE agency_subscriptions SET
       status = ?,
       current_period_end = COALESCE(?, current_period_end),
       grace_period_ends_at = ?,
       razorpay_customer_id = COALESCE(?, razorpay_customer_id)
     WHERE razorpay_subscription_id = ?`,
    [status, currentPeriodEnd ?? null, gracePeriodEndsAt ?? null, razorpayCustomerId ?? null, razorpaySubscriptionId]
  );
  return result.affectedRows > 0;
}

// Self-service cancellation (billingService.cancelAgencySubscription) —
// written immediately after Razorpay's synchronous cancel-at-cycle-end API
// response confirms the request was accepted. status itself is untouched
// here; only the webhook (applyWebhookState above) ever writes it.
async function setAutoRenewFalse(tenantId) {
  const [result] = await pool.query(`UPDATE agency_subscriptions SET auto_renew = FALSE WHERE tenant_id = ?`, [tenantId]);
  if (result.affectedRows === 0) return null;
  return findByTenant(tenantId);
}

module.exports = { findByTenant, findByRazorpaySubscriptionId, create, applyWebhookState, setAutoRenewFalse };
