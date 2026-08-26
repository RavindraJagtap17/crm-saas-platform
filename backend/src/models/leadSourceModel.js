const pool = require("../config/db");

async function list(tenantId) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, name, type, created_at, updated_at
     FROM lead_sources WHERE tenant_id = ? ORDER BY name ASC`,
    [tenantId]
  );
  return rows;
}

async function findById(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, name, type, created_at, updated_at
     FROM lead_sources WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function findByName(tenantId, name) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, name, type, created_at, updated_at
     FROM lead_sources WHERE tenant_id = ? AND name = ? LIMIT 1`,
    [tenantId, name]
  );
  return rows[0] || null;
}

async function create(tenantId, { name, type }) {
  const [result] = await pool.query(
    `INSERT INTO lead_sources (tenant_id, name, type) VALUES (?, ?, ?)`,
    [tenantId, name, type || null]
  );
  return findById(tenantId, result.insertId);
}

async function update(tenantId, id, { name, type }) {
  const [result] = await pool.query(
    `UPDATE lead_sources SET
       name = COALESCE(?, name),
       type = COALESCE(?, type)
     WHERE id = ? AND tenant_id = ?`,
    [name ?? null, type ?? null, id, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id);
}

// Manual lead entry (§C) needs a canonical "Manual" source per tenant.
// Idempotent: returns the existing one if it's already been created,
// otherwise creates it. No hard-coded cross-tenant/global row — each
// tenant gets its own, created lazily on first use.
const MANUAL_SOURCE_NAME = "Manual";
const MANUAL_SOURCE_TYPE = "manual";

async function findOrCreateManualSource(tenantId) {
  const existing = await findByName(tenantId, MANUAL_SOURCE_NAME);
  if (existing) return existing;
  return create(tenantId, { name: MANUAL_SOURCE_NAME, type: MANUAL_SOURCE_TYPE });
}

module.exports = { list, findById, findByName, create, update, findOrCreateManualSource };
