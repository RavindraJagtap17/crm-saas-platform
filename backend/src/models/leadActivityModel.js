const pool = require("../config/db");
const clientModel = require("./clientModel");

// type is intentionally a free-ish string, not a DB enum (matches the
// Step 2 schema) — the service layer constrains it to a known set.
//
// tenant_id is still NOT NULL/no-default on this table (Phase B additive
// strategy) — resolved from client_id purely to satisfy that constraint;
// never read back or used for scoping.
async function create(conn, clientId, { leadId, userId, type, remarks, outcome }) {
  const runner = conn || pool;
  const tenantId = await clientModel.findTenantIdForClient(clientId);
  const [result] = await runner.query(
    `INSERT INTO lead_activities (tenant_id, client_id, lead_id, user_id, type, remarks, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, clientId, leadId, userId ?? null, type, remarks ?? null, outcome ?? null]
  );
  const [rows] = await runner.query(`SELECT * FROM lead_activities WHERE id = ?`, [result.insertId]);
  return rows[0];
}

async function listForLead(clientId, leadId) {
  const [rows] = await pool.query(
    `SELECT a.*, u.name AS user_name, u.email AS user_email
     FROM lead_activities a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.client_id = ? AND a.lead_id = ?
     ORDER BY a.created_at ASC, a.id ASC`,
    [clientId, leadId]
  );
  return rows;
}

module.exports = { create, listForLead };
