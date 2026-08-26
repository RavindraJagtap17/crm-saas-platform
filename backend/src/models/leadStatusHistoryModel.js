const pool = require("../config/db");

async function create(conn, tenantId, { leadId, fromStatusId, toStatusId, changedBy }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT INTO lead_status_history (tenant_id, lead_id, from_status_id, to_status_id, changed_by)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, leadId, fromStatusId ?? null, toStatusId, changedBy ?? null]
  );
  const [rows] = await runner.query(`SELECT * FROM lead_status_history WHERE id = ?`, [result.insertId]);
  return rows[0];
}

async function listForLead(tenantId, leadId) {
  const [rows] = await pool.query(
    `SELECT h.*, u.name AS changed_by_name
     FROM lead_status_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.tenant_id = ? AND h.lead_id = ?
     ORDER BY h.changed_at ASC, h.id ASC`,
    [tenantId, leadId]
  );
  return rows;
}

module.exports = { create, listForLead };
