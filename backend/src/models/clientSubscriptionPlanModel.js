const pool = require("../config/db");

// Agency-scoped Client plan catalog (migration 043) — every query here is
// scoped to (tenantId, id), mirroring clientModel.js's own tenant-isolation
// pattern exactly: an Agency Admin can only ever resolve a plan that
// belongs to their own agency, never another agency's.
const COLUMNS = `
  id, tenant_id, name, price, currency, billing_cycle, max_active_employees, is_active, created_at, updated_at
`;

async function listByTenant(tenantId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM client_subscription_plans WHERE tenant_id = ? ORDER BY created_at ASC`, [
    tenantId,
  ]);
  return rows;
}

// "New Clients should only see active plans" (§10) — the future Client-
// facing plan-picker's read path; unused by this step's Agency Admin
// management endpoints (those always see everything via listByTenant),
// added now since the model is the natural place for it and it requires
// no schema change — kept unwired to any route until Client subscription
// work begins.
async function listActiveByTenant(tenantId) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM client_subscription_plans WHERE tenant_id = ? AND is_active = TRUE ORDER BY price ASC`,
    [tenantId]
  );
  return rows;
}

async function findById(tenantId, id) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM client_subscription_plans WHERE id = ? AND tenant_id = ? LIMIT 1`, [
    id,
    tenantId,
  ]);
  return rows[0] || null;
}

async function create(tenantId, { name, price, currency, billingCycle, maxActiveEmployees }) {
  const [result] = await pool.query(
    `INSERT INTO client_subscription_plans (tenant_id, name, price, currency, billing_cycle, max_active_employees)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, name, price, currency, billingCycle, maxActiveEmployees]
  );
  return findById(tenantId, result.insertId);
}

// Partial update — every field COALESCE'd against its current value, same
// convention as subscriptionPlanModel.update. max_active_employees can be
// legitimately 0, so `?? null` (not `|| null`) is required here — 0 must
// pass through as 0, not be treated as "omitted".
async function update(tenantId, id, { name, price, currency, billingCycle, maxActiveEmployees }) {
  const [result] = await pool.query(
    `UPDATE client_subscription_plans SET
       name = COALESCE(?, name),
       price = COALESCE(?, price),
       currency = COALESCE(?, currency),
       billing_cycle = COALESCE(?, billing_cycle),
       max_active_employees = COALESCE(?, max_active_employees)
     WHERE id = ? AND tenant_id = ?`,
    [name ?? null, price ?? null, currency ?? null, billingCycle ?? null, maxActiveEmployees ?? null, id, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id);
}

// §7/§8/§9: soft deactivation only — never a DELETE. is_active=false just
// removes the plan from new selection; the row (and every FK reference to
// it, present or future) is untouched, matching
// fk_client_subscriptions_tenant_plan's RESTRICT-on-delete guarantee from
// migration 044.
async function setActive(tenantId, id, isActive) {
  const [result] = await pool.query(`UPDATE client_subscription_plans SET is_active = ? WHERE id = ? AND tenant_id = ?`, [
    !!isActive,
    id,
    tenantId,
  ]);
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id);
}

module.exports = { listByTenant, listActiveByTenant, findById, create, update, setActive };
