const pool = require("../config/db");

const COLUMNS = `
  id, name, price, currency, billing_cycle, features, razorpay_plan_id,
  max_clients, is_active, created_at, updated_at
`;

function parseRow(row) {
  if (!row) return row;
  return { ...row, features: typeof row.features === "string" ? JSON.parse(row.features) : row.features };
}

// Tenant-facing catalog — only what a tenant is allowed to select (§B:
// deactivating a plan removes it from new selection without touching
// Razorpay or any existing subscriber).
async function listActive() {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM subscription_plans WHERE is_active = TRUE ORDER BY price ASC`);
  return rows.map(parseRow);
}

// Super Admin catalog management — every plan, active or not.
async function listAll() {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM subscription_plans ORDER BY created_at DESC`);
  return rows.map(parseRow);
}

async function findById(id) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM subscription_plans WHERE id = ? LIMIT 1`, [id]);
  return parseRow(rows[0] || null);
}

async function findByRazorpayPlanId(razorpayPlanId, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM subscription_plans WHERE razorpay_plan_id = ? LIMIT 1`, [razorpayPlanId]);
  return parseRow(rows[0] || null);
}

async function create({ name, price, currency, billingCycle, features, razorpayPlanId, maxClients }) {
  const [result] = await pool.query(
    `INSERT INTO subscription_plans (name, price, currency, billing_cycle, features, razorpay_plan_id, max_clients)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, price, currency, billingCycle, features ? JSON.stringify(features) : null, razorpayPlanId, maxClients ?? null]
  );
  return findById(result.insertId);
}

// name/price/currency/billing_cycle/features are editable (they're OUR
// descriptive record); razorpay_plan_id is deliberately NOT — a plan that
// needs a different Razorpay Plan is a different local plan (§B: Razorpay
// Plans are immutable, so re-pointing an existing local row at a new one
// would silently change what every existing subscriber's history refers
// to). is_active is the one operational toggle (see setActive below).
async function update(id, { name, price, currency, billingCycle, features, maxClients, maxClientsProvided }) {
  // max_clients needs a real branch, not COALESCE(?, max_clients) — that
  // pattern can't distinguish "field omitted" from "explicitly set to
  // NULL (unlimited)", both of which arrive here as a JS null/undefined.
  // maxClientsProvided (set by billingValidators.validateUpdatePlan) is
  // the caller's explicit signal for which one this is.
  const maxClientsSql = maxClientsProvided ? "max_clients = ?" : "max_clients = max_clients";
  const [result] = await pool.query(
    `UPDATE subscription_plans SET
       name = COALESCE(?, name),
       price = COALESCE(?, price),
       currency = COALESCE(?, currency),
       billing_cycle = COALESCE(?, billing_cycle),
       features = COALESCE(?, features),
       ${maxClientsSql}
     WHERE id = ?`,
    [
      name ?? null,
      price ?? null,
      currency ?? null,
      billingCycle ?? null,
      features ? JSON.stringify(features) : null,
      ...(maxClientsProvided ? [maxClients] : []),
      id,
    ]
  );
  if (result.affectedRows === 0) return null;
  return findById(id);
}

async function setActive(id, isActive) {
  const [result] = await pool.query(`UPDATE subscription_plans SET is_active = ? WHERE id = ?`, [!!isActive, id]);
  if (result.affectedRows === 0) return null;
  return findById(id);
}

module.exports = { listActive, listAll, findById, findByRazorpayPlanId, create, update, setActive };
