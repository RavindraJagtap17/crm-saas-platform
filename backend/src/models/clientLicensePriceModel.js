const pool = require("../config/db");

const COLUMNS = `id, price, currency, created_at, updated_at`;

// Singleton table (uq_client_license_price_singleton, migration 055) — at
// most one row ever exists. Returns null when Super Admin hasn't set a
// price yet — a valid, expected state, not an error (same contract as
// agencySubscriptionPlanModel.get).
async function get() {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM client_license_price WHERE singleton_guard = 1 LIMIT 1`);
  return rows[0] || null;
}

// Explicit get-then-branch upsert, matching agencySubscriptionPlanModel's
// own established convention for this codebase's singleton tables.
async function upsert({ price, currency }) {
  const existing = await get();
  if (!existing) {
    await pool.query(`INSERT INTO client_license_price (singleton_guard, price, currency) VALUES (1, ?, ?)`, [price, currency]);
  } else {
    await pool.query(`UPDATE client_license_price SET price = ?, currency = ? WHERE singleton_guard = 1`, [price, currency]);
  }
  return get();
}

module.exports = { get, upsert };
