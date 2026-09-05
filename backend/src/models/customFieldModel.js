const pool = require("../config/db");
const clientModel = require("./clientModel");

// tenant_id is still NOT NULL/no-default on this table (Phase B additive
// strategy) — create() populates it, resolved from client_id, purely to
// satisfy that constraint; never read back or used for scoping.

async function list(clientId, { includeInactive = false } = {}) {
  const sql = includeInactive
    ? `SELECT id, client_id, field_key, label, field_type, options, is_active, created_at, updated_at
       FROM custom_field_definitions WHERE client_id = ? ORDER BY id ASC`
    : `SELECT id, client_id, field_key, label, field_type, options, is_active, created_at, updated_at
       FROM custom_field_definitions WHERE client_id = ? AND is_active = TRUE ORDER BY id ASC`;
  const [rows] = await pool.query(sql, [clientId]);
  return rows;
}

async function findById(clientId, id) {
  const [rows] = await pool.query(
    `SELECT id, client_id, field_key, label, field_type, options, is_active, created_at, updated_at
     FROM custom_field_definitions WHERE id = ? AND client_id = ? LIMIT 1`,
    [id, clientId]
  );
  return rows[0] || null;
}

async function findByKey(clientId, fieldKey) {
  const [rows] = await pool.query(
    `SELECT id, client_id, field_key, label, field_type, options, is_active, created_at, updated_at
     FROM custom_field_definitions WHERE client_id = ? AND field_key = ? LIMIT 1`,
    [clientId, fieldKey]
  );
  return rows[0] || null;
}

async function create(clientId, { fieldKey, label, fieldType, options }) {
  const tenantId = await clientModel.findTenantIdForClient(clientId);
  const [result] = await pool.query(
    `INSERT INTO custom_field_definitions (tenant_id, client_id, field_key, label, field_type, options, is_active)
     VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
    [tenantId, clientId, fieldKey, label, fieldType, options ? JSON.stringify(options) : null]
  );
  return findById(clientId, result.insertId);
}

async function update(clientId, id, { label, options, isActive }) {
  const [result] = await pool.query(
    `UPDATE custom_field_definitions SET
       label = COALESCE(?, label),
       options = COALESCE(?, options),
       is_active = COALESCE(?, is_active)
     WHERE id = ? AND client_id = ?`,
    [label ?? null, options ? JSON.stringify(options) : null, isActive === undefined ? null : !!isActive, id, clientId]
  );
  if (result.affectedRows === 0) return null;
  return findById(clientId, id);
}

module.exports = { list, findById, findByKey, create, update };
