const pool = require("../config/db");

const COLUMNS = `
  id, price, currency, billing_cycle, razorpay_plan_id, is_active, created_at, updated_at
`;

// Singleton table (uq_agency_subscription_plan_singleton, migration 041) —
// at most one row ever exists. Returns null when Super Admin hasn't
// configured the plan yet — a valid, expected state, not an error.
async function get() {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM agency_subscription_plan WHERE singleton_guard = 1 LIMIT 1`);
  return rows[0] || null;
}

// Explicit get-then-branch upsert (not a single ON DUPLICATE KEY UPDATE
// statement) to match this codebase's existing convention — every other
// model here uses explicit control flow rather than a single-statement
// upsert idiom. razorpay_plan_id is the one field that can be left
// untouched when omitted (Super Admin may set the price before the
// matching Razorpay Plan exists), via the same COALESCE pattern
// subscriptionPlanModel.update already uses for its optional fields.
async function upsert({ price, currency, razorpayPlanId, isActive }) {
  const existing = await get();
  if (!existing) {
    await pool.query(
      `INSERT INTO agency_subscription_plan (singleton_guard, price, currency, razorpay_plan_id, is_active)
       VALUES (1, ?, ?, ?, ?)`,
      [price, currency, razorpayPlanId ?? null, isActive]
    );
  } else {
    await pool.query(
      `UPDATE agency_subscription_plan SET
         price = ?,
         currency = ?,
         razorpay_plan_id = COALESCE(?, razorpay_plan_id),
         is_active = ?
       WHERE singleton_guard = 1`,
      [price, currency, razorpayPlanId ?? null, isActive]
    );
  }
  return get();
}

module.exports = { get, upsert };
