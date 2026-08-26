const pool = require("../config/db");

const COLUMNS = `
  id, tenant_id, subscription_id, razorpay_payment_id, razorpay_order_id,
  amount, currency, status, paid_at, created_at, updated_at
`;

async function findByRazorpayPaymentId(razorpayPaymentId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM payments WHERE razorpay_payment_id = ? LIMIT 1`, [razorpayPaymentId]);
  return rows[0] || null;
}

// §M/§L: INSERT IGNORE against the UNIQUE razorpay_payment_id — a retried
// webhook for a payment already recorded is a silent no-op here, not a
// duplicate ledger row. Returns null (not the existing row) when skipped,
// so the caller can tell "recorded now" apart from "already had it".
async function recordIfAbsent(conn, { tenantId, subscriptionId, razorpayPaymentId, razorpayOrderId, amount, currency, status, paidAt }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT IGNORE INTO payments
       (tenant_id, subscription_id, razorpay_payment_id, razorpay_order_id, amount, currency, status, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, subscriptionId, razorpayPaymentId, razorpayOrderId ?? null, amount, currency, status, paidAt ?? null]
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM payments WHERE id = ?`, [result.insertId]);
  return rows[0];
}

async function listForTenant(tenantId, limit = 50) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM payments WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
    [tenantId, limit]
  );
  return rows;
}

module.exports = { findByRazorpayPaymentId, recordIfAbsent, listForTenant };
