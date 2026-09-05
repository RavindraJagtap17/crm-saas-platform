const pool = require("../config/db");
const clientModel = require("./clientModel");

// tenant_id is still NOT NULL/no-default on this table (Phase B additive
// strategy) — create() populates it, resolved from client_id, purely to
// satisfy that constraint; never read back or used for scoping.

async function list(clientId, { includeInactive = false } = {}) {
  const sql = includeInactive
    ? `SELECT id, client_id, name, description, is_active, created_at, updated_at
       FROM products WHERE client_id = ? ORDER BY name ASC`
    : `SELECT id, client_id, name, description, is_active, created_at, updated_at
       FROM products WHERE client_id = ? AND is_active = TRUE ORDER BY name ASC`;
  const [rows] = await pool.query(sql, [clientId]);
  return rows;
}

async function findById(clientId, id) {
  const [rows] = await pool.query(
    `SELECT id, client_id, name, description, is_active, created_at, updated_at
     FROM products WHERE id = ? AND client_id = ? LIMIT 1`,
    [id, clientId]
  );
  return rows[0] || null;
}

async function create(clientId, { name, description, isActive }) {
  const tenantId = await clientModel.findTenantIdForClient(clientId);
  const [result] = await pool.query(
    `INSERT INTO products (tenant_id, client_id, name, description, is_active) VALUES (?, ?, ?, ?, ?)`,
    [tenantId, clientId, name, description ?? null, isActive === undefined ? true : !!isActive]
  );
  return findById(clientId, result.insertId);
}

async function update(clientId, id, { name, description, isActive }) {
  const [result] = await pool.query(
    `UPDATE products SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       is_active = COALESCE(?, is_active)
     WHERE id = ? AND client_id = ?`,
    [name ?? null, description ?? null, isActive === undefined ? null : !!isActive, id, clientId]
  );
  if (result.affectedRows === 0) return null;
  return findById(clientId, id);
}

module.exports = { list, findById, create, update };
