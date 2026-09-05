const pool = require("../config/db");

// Append-only Client payment ledger (migration 045) — mirrors paymentModel.js
// (the Agency-side equivalent) exactly, one level down: webhook-confirmed
// only, never a client-reported result. razorpay_payment_id is the
// idempotency guarantee (UNIQUE), same as the Agency-side table.
const COLUMNS = `
  id, tenant_id, client_id, client_subscription_id, razorpay_payment_id, razorpay_order_id,
  amount, currency, status, paid_at, created_at, updated_at
`;

async function findByRazorpayPaymentId(razorpayPaymentId, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM client_payments WHERE razorpay_payment_id = ? LIMIT 1`, [
    razorpayPaymentId,
  ]);
  return rows[0] || null;
}

// INSERT IGNORE against UNIQUE(razorpay_payment_id) — a retried webhook
// for a payment already recorded is a silent no-op here, not a duplicate
// ledger row. Returns null (not the existing row) when skipped, so the
// caller can distinguish "recorded now" from "already had it" — the
// primary idempotency mechanism for this step (see
// clientPaymentWebhookService.js).
async function recordIfAbsent(
  conn,
  { tenantId, clientId, clientSubscriptionId, razorpayPaymentId, razorpayOrderId, amount, currency, status, paidAt }
) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT IGNORE INTO client_payments
       (tenant_id, client_id, client_subscription_id, razorpay_payment_id, razorpay_order_id, amount, currency, status, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, clientId, clientSubscriptionId, razorpayPaymentId, razorpayOrderId ?? null, amount, currency, status, paidAt ?? null]
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM client_payments WHERE id = ?`, [result.insertId]);
  return rows[0];
}

async function listForClient(clientId, limit = 50) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM client_payments WHERE client_id = ? ORDER BY id DESC LIMIT ?`, [
    clientId,
    limit,
  ]);
  return rows;
}

module.exports = { findByRazorpayPaymentId, recordIfAbsent, listForClient };
