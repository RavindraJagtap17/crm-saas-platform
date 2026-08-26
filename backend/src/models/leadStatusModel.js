const pool = require("../config/db");

async function list(tenantId) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, name, color, sort_order, is_final, created_by, created_at, updated_at
     FROM lead_statuses WHERE tenant_id = ? ORDER BY sort_order ASC, id ASC`,
    [tenantId]
  );
  return rows;
}

async function findById(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, name, color, sort_order, is_final, created_by, created_at, updated_at
     FROM lead_statuses WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function create(tenantId, { name, color, sortOrder, isFinal, createdBy }) {
  const [result] = await pool.query(
    `INSERT INTO lead_statuses (tenant_id, name, color, sort_order, is_final, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, name, color ?? null, sortOrder ?? 0, !!isFinal, createdBy]
  );
  return findById(tenantId, result.insertId);
}

async function update(tenantId, id, { name, color, sortOrder, isFinal }) {
  const [result] = await pool.query(
    `UPDATE lead_statuses SET
       name = COALESCE(?, name),
       color = COALESCE(?, color),
       sort_order = COALESCE(?, sort_order),
       is_final = COALESCE(?, is_final)
     WHERE id = ? AND tenant_id = ?`,
    [name ?? null, color ?? null, sortOrder ?? null, isFinal === undefined ? null : !!isFinal, id, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id);
}

module.exports = { list, findById, create, update };
