const pool = require("../config/db");
const clientModel = require("./clientModel");

// tenant_id is still NOT NULL/no-default on this table (Phase B additive
// strategy) — resolved from client_id purely to satisfy that constraint;
// never read back or used for scoping.
async function create(conn, clientId, { leadId, fromStatusId, toStatusId, changedBy }) {
  const runner = conn || pool;
  const tenantId = await clientModel.findTenantIdForClient(clientId);
  const [result] = await runner.query(
    `INSERT INTO lead_status_history (tenant_id, client_id, lead_id, from_status_id, to_status_id, changed_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, clientId, leadId, fromStatusId ?? null, toStatusId, changedBy ?? null]
  );
  const [rows] = await runner.query(`SELECT * FROM lead_status_history WHERE id = ?`, [result.insertId]);
  return rows[0];
}

async function listForLead(clientId, leadId) {
  const [rows] = await pool.query(
    `SELECT h.*, u.name AS changed_by_name
     FROM lead_status_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.client_id = ? AND h.lead_id = ?
     ORDER BY h.changed_at ASC, h.id ASC`,
    [clientId, leadId]
  );
  return rows;
}

module.exports = { create, listForLead };
