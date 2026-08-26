const pool = require("../config/db");

async function list(tenantId, { includeInactive = false } = {}) {
  const sql = includeInactive
    ? `SELECT id, tenant_id, name, description, is_active, created_at, updated_at
       FROM products WHERE tenant_id = ? ORDER BY name ASC`
    : `SELECT id, tenant_id, name, description, is_active, created_at, updated_at
       FROM products WHERE tenant_id = ? AND is_active = TRUE ORDER BY name ASC`;
  const [rows] = await pool.query(sql, [tenantId]);
  return rows;
}

async function findById(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, name, description, is_active, created_at, updated_at
     FROM products WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function create(tenantId, { name, description, isActive }) {
  const [result] = await pool.query(
    `INSERT INTO products (tenant_id, name, description, is_active) VALUES (?, ?, ?, ?)`,
    [tenantId, name, description ?? null, isActive === undefined ? true : !!isActive]
  );
  return findById(tenantId, result.insertId);
}

async function update(tenantId, id, { name, description, isActive }) {
  const [result] = await pool.query(
    `UPDATE products SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       is_active = COALESCE(?, is_active)
     WHERE id = ? AND tenant_id = ?`,
    [name ?? null, description ?? null, isActive === undefined ? null : !!isActive, id, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id);
}

module.exports = { list, findById, create, update };
