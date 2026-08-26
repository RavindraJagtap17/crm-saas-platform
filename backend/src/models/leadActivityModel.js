const pool = require("../config/db");

// type is intentionally a free-ish string, not a DB enum (matches the
// Step 2 schema) — the service layer constrains it to a known set.
async function create(conn, tenantId, { leadId, userId, type, remarks, outcome }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT INTO lead_activities (tenant_id, lead_id, user_id, type, remarks, outcome)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, leadId, userId ?? null, type, remarks ?? null, outcome ?? null]
  );
  const [rows] = await runner.query(`SELECT * FROM lead_activities WHERE id = ?`, [result.insertId]);
  return rows[0];
}

async function listForLead(tenantId, leadId) {
  const [rows] = await pool.query(
    `SELECT a.*, u.name AS user_name, u.email AS user_email
     FROM lead_activities a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.tenant_id = ? AND a.lead_id = ?
     ORDER BY a.created_at ASC, a.id ASC`,
    [tenantId, leadId]
  );
  return rows;
}

module.exports = { create, listForLead };
