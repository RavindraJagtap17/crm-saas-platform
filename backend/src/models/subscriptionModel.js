const pool = require("../config/db");

const COLUMNS = `
  id, tenant_id, plan_id, razorpay_subscription_id, razorpay_customer_id,
  status, current_period_end, created_at, updated_at
`;

async function findByTenant(tenantId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM subscriptions WHERE tenant_id = ? LIMIT 1`, [tenantId]);
  return rows[0] || null;
}

async function findByRazorpaySubscriptionId(razorpaySubscriptionId, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM subscriptions WHERE razorpay_subscription_id = ? LIMIT 1`, [
    razorpaySubscriptionId,
  ]);
  return rows[0] || null;
}

// One row per tenant (§A UNIQUE constraint) — creating a subscription for
// a tenant that already has one is a programming error, not a case this
// silently handles; callers (billingService) are expected to have already
// confirmed there isn't one.
async function create(conn, { tenantId, planId, razorpaySubscriptionId, razorpayCustomerId, status }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT INTO subscriptions (tenant_id, plan_id, razorpay_subscription_id, razorpay_customer_id, status)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, planId, razorpaySubscriptionId, razorpayCustomerId, status]
  );
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM subscriptions WHERE id = ?`, [result.insertId]);
  return rows[0];
}

// §G: the webhook-reconciliation write path — every field here is set
// from webhook-CONFIRMED Razorpay state, never from a client request.
// planId is optional: only passed once the webhook confirms the new plan
// is actually effective (§J) — omitted, the existing plan_id is left
// untouched rather than being prematurely overwritten.
async function applyWebhookState(conn, razorpaySubscriptionId, { status, planId, currentPeriodEnd, razorpayCustomerId }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE subscriptions SET
       status = ?,
       plan_id = COALESCE(?, plan_id),
       current_period_end = COALESCE(?, current_period_end),
       razorpay_customer_id = COALESCE(?, razorpay_customer_id)
     WHERE razorpay_subscription_id = ?`,
    [status, planId ?? null, currentPeriodEnd ?? null, razorpayCustomerId ?? null, razorpaySubscriptionId]
  );
  return result.affectedRows > 0;
}

module.exports = { findByTenant, findByRazorpaySubscriptionId, create, applyWebhookState };
