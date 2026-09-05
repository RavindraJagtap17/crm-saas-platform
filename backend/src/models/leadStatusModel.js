const pool = require("../config/db");
const clientModel = require("./clientModel");

// tenant_id is still NOT NULL/no-default on this table (Phase B additive
// strategy) — create() populates it, resolved from client_id, purely to
// satisfy that constraint; never read back or used for scoping.

async function list(clientId) {
  const [rows] = await pool.query(
    `SELECT id, client_id, name, color, sort_order, is_final, created_by, created_at, updated_at
     FROM lead_statuses WHERE client_id = ? ORDER BY sort_order ASC, id ASC`,
    [clientId]
  );
  return rows;
}

async function findById(clientId, id) {
  const [rows] = await pool.query(
    `SELECT id, client_id, name, color, sort_order, is_final, created_by, created_at, updated_at
     FROM lead_statuses WHERE id = ? AND client_id = ? LIMIT 1`,
    [id, clientId]
  );
  return rows[0] || null;
}

async function create(clientId, { name, color, sortOrder, isFinal, createdBy }) {
  const tenantId = await clientModel.findTenantIdForClient(clientId);
  const [result] = await pool.query(
    `INSERT INTO lead_statuses (tenant_id, client_id, name, color, sort_order, is_final, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, clientId, name, color ?? null, sortOrder ?? 0, !!isFinal, createdBy]
  );
  return findById(clientId, result.insertId);
}

async function update(clientId, id, { name, color, sortOrder, isFinal }) {
  const [result] = await pool.query(
    `UPDATE lead_statuses SET
       name = COALESCE(?, name),
       color = COALESCE(?, color),
       sort_order = COALESCE(?, sort_order),
       is_final = COALESCE(?, is_final)
     WHERE id = ? AND client_id = ?`,
    [name ?? null, color ?? null, sortOrder ?? null, isFinal === undefined ? null : !!isFinal, id, clientId]
  );
  if (result.affectedRows === 0) return null;
  return findById(clientId, id);
}

module.exports = { list, findById, create, update };
