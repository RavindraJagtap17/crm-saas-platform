const pool = require("../config/db");

async function list(tenantId, { includeInactive = false } = {}) {
  const sql = includeInactive
    ? `SELECT id, tenant_id, field_key, label, field_type, options, is_active, created_at, updated_at
       FROM custom_field_definitions WHERE tenant_id = ? ORDER BY id ASC`
    : `SELECT id, tenant_id, field_key, label, field_type, options, is_active, created_at, updated_at
       FROM custom_field_definitions WHERE tenant_id = ? AND is_active = TRUE ORDER BY id ASC`;
  const [rows] = await pool.query(sql, [tenantId]);
  return rows;
}

async function findById(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, field_key, label, field_type, options, is_active, created_at, updated_at
     FROM custom_field_definitions WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function findByKey(tenantId, fieldKey) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, field_key, label, field_type, options, is_active, created_at, updated_at
     FROM custom_field_definitions WHERE tenant_id = ? AND field_key = ? LIMIT 1`,
    [tenantId, fieldKey]
  );
  return rows[0] || null;
}

async function create(tenantId, { fieldKey, label, fieldType, options }) {
  const [result] = await pool.query(
    `INSERT INTO custom_field_definitions (tenant_id, field_key, label, field_type, options, is_active)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [tenantId, fieldKey, label, fieldType, options ? JSON.stringify(options) : null]
  );
  return findById(tenantId, result.insertId);
}

async function update(tenantId, id, { label, options, isActive }) {
  const [result] = await pool.query(
    `UPDATE custom_field_definitions SET
       label = COALESCE(?, label),
       options = COALESCE(?, options),
       is_active = COALESCE(?, is_active)
     WHERE id = ? AND tenant_id = ?`,
    [label ?? null, options ? JSON.stringify(options) : null, isActive === undefined ? null : !!isActive, id, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id);
}

module.exports = { list, findById, findByKey, create, update };
