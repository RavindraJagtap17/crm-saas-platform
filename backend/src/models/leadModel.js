const pool = require("../config/db");
const clientModel = require("./clientModel");

// B2B2C restructure: leads are CLIENT-scoped, not agency-scoped — every
// READ here keys on client_id (added alongside the old tenant_id in Phase
// B's migration 034). The composite FKs added in that same migration
// ((client_id, source_id) -> lead_sources(client_id, id), etc.) are what
// make a cross-client reference structurally impossible.
//
// tenant_id is still NOT NULL with no default on this table (Phase B's
// additive-only strategy deliberately left it that way, so the not-yet-
// refactored app could keep running between Phase B and Phase C) — insert()
// below still populates it, resolved from client_id, purely to satisfy
// that constraint. It is never read back or used for scoping by any
// application code; client_id is the only scope that matters now.
const BASE_COLUMNS = `
  id, client_id, name, phone, email, source_id, product_id, status_id, assigned_to,
  custom_fields, meta_lead_id, is_duplicate, duplicate_of_lead_id, converted_at,
  created_at, updated_at
`;

// Every read here takes clientId as a required parameter and, for an
// employee caller, an optional restrictToUserId — baked directly into the
// WHERE clause so an out-of-scope lead is indistinguishable from a
// nonexistent one, rather than relying on a separate authorization check
// after the fact.
function scopeClause({ restrictToUserId }) {
  return restrictToUserId ? "AND assigned_to = ?" : "";
}
function scopeParams({ restrictToUserId }) {
  return restrictToUserId ? [restrictToUserId] : [];
}

async function findById(clientId, id, scope = {}) {
  const [rows] = await pool.query(
    `SELECT ${BASE_COLUMNS} FROM leads WHERE id = ? AND client_id = ? ${scopeClause(scope)} LIMIT 1`,
    [id, clientId, ...scopeParams(scope)]
  );
  return rows[0] || null;
}

// Locks any existing matching row(s) so two concurrent creations with the
// same phone number can't both see "no duplicate yet" — must be called
// inside the same transaction as the subsequent insert.
async function findEarliestByPhoneForUpdate(conn, clientId, normalizedPhone) {
  if (!normalizedPhone) return null;
  const [rows] = await conn.query(
    `SELECT id FROM leads WHERE client_id = ? AND phone = ? ORDER BY id ASC LIMIT 1 FOR UPDATE`,
    [clientId, normalizedPhone]
  );
  return rows[0] || null;
}

async function insert(conn, clientId, lead) {
  const runner = conn || pool;
  const tenantId = await clientModel.findTenantIdForClient(clientId);
  const [result] = await runner.query(
    `INSERT INTO leads
       (tenant_id, client_id, name, phone, email, source_id, product_id, status_id, assigned_to,
        custom_fields, meta_lead_id, is_duplicate, duplicate_of_lead_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      clientId,
      lead.name ?? null,
      lead.phone ?? null,
      lead.email ?? null,
      lead.sourceId ?? null,
      lead.productId ?? null,
      lead.statusId ?? null,
      lead.assignedTo ?? null,
      lead.customFields ? JSON.stringify(lead.customFields) : null,
      lead.metaLeadId ?? null,
      !!lead.isDuplicate,
      lead.duplicateOfLeadId ?? null,
    ]
  );
  const [rows] = await runner.query(`SELECT ${BASE_COLUMNS} FROM leads WHERE id = ?`, [result.insertId]);
  return rows[0];
}

// Step 7 idempotency (§K): meta_lead_id has a global UNIQUE index
// (migration 007) — this is the pre-check; the constraint itself is the
// backstop against a race between two near-simultaneous webhook
// deliveries for the same Meta lead (see metaLeadService.js). Still
// deliberately global (not client-scoped) — meta_lead_id identity comes
// from Meta itself, cross-client by construction.
async function findByMetaLeadId(metaLeadId) {
  const [rows] = await pool.query(`SELECT ${BASE_COLUMNS} FROM leads WHERE meta_lead_id = ? LIMIT 1`, [metaLeadId]);
  return rows[0] || null;
}

async function count(clientId, { restrictToUserId, filters = {} } = {}) {
  const { where, params } = buildFilterWhere(clientId, { restrictToUserId, filters });
  const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM leads WHERE ${where}`, params);
  return rows[0].total;
}

async function list(clientId, { restrictToUserId, filters = {}, limit, offset } = {}) {
  const { where, params } = buildFilterWhere(clientId, { restrictToUserId, filters });
  const [rows] = await pool.query(
    `SELECT ${BASE_COLUMNS} FROM leads WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows;
}

function buildFilterWhere(clientId, { restrictToUserId, filters }) {
  const clauses = ["client_id = ?"];
  const params = [clientId];

  if (restrictToUserId) {
    clauses.push("assigned_to = ?");
    params.push(restrictToUserId);
  }
  if (filters.statusId) {
    clauses.push("status_id = ?");
    params.push(filters.statusId);
  }
  if (filters.sourceId) {
    clauses.push("source_id = ?");
    params.push(filters.sourceId);
  }
  if (filters.productId) {
    clauses.push("product_id = ?");
    params.push(filters.productId);
  }
  if (filters.assignedTo) {
    clauses.push("assigned_to = ?");
    params.push(filters.assignedTo);
  }
  if (filters.isDuplicate !== undefined) {
    clauses.push("is_duplicate = ?");
    params.push(!!filters.isDuplicate);
  }
  if (filters.q) {
    // Client-scoped substring match on the fields a user would actually
    // search by — never crosses the client_id clause already above.
    clauses.push("(name LIKE ? OR phone LIKE ? OR email LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }

  return { where: clauses.join(" AND "), params };
}

// Only ever touches the plain, non-side-effecting fields. Status and
// assignment changes go through updateStatus/updateAssignment because
// each of those requires writing a companion history/activity row.
async function updateFields(clientId, id, patch, scope = {}) {
  const sets = [];
  const params = [];

  if (patch.name !== undefined) { sets.push("name = ?"); params.push(patch.name); }
  if (patch.phone !== undefined) { sets.push("phone = ?"); params.push(patch.phone); }
  if (patch.email !== undefined) { sets.push("email = ?"); params.push(patch.email); }
  if (patch.sourceId !== undefined) { sets.push("source_id = ?"); params.push(patch.sourceId); }
  if (patch.productId !== undefined) { sets.push("product_id = ?"); params.push(patch.productId); }
  if (patch.customFields !== undefined) { sets.push("custom_fields = ?"); params.push(JSON.stringify(patch.customFields)); }

  if (sets.length === 0) return findById(clientId, id, scope);

  const [result] = await pool.query(
    `UPDATE leads SET ${sets.join(", ")} WHERE id = ? AND client_id = ? ${scopeClause(scope)}`,
    [...params, id, clientId, ...scopeParams(scope)]
  );
  if (result.affectedRows === 0) return null;
  return findById(clientId, id, scope);
}

async function updateStatus(conn, clientId, id, statusId, scope = {}) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE leads SET status_id = ? WHERE id = ? AND client_id = ? ${scopeClause(scope)}`,
    [statusId, id, clientId, ...scopeParams(scope)]
  );
  return result.affectedRows > 0;
}

async function updateAssignment(conn, clientId, id, assignedTo) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE leads SET assigned_to = ? WHERE id = ? AND client_id = ?`,
    [assignedTo, id, clientId]
  );
  return result.affectedRows > 0;
}

async function remove(clientId, id) {
  const [result] = await pool.query(`DELETE FROM leads WHERE id = ? AND client_id = ?`, [id, clientId]);
  return result.affectedRows > 0;
}

// ---- Dashboard aggregates (§E) — grouped counts, not full row fetches,
// so this scales past the 100-row page cap the list endpoint is capped at.

async function sourceBreakdown(clientId) {
  const [rows] = await pool.query(
    `SELECT s.id AS source_id, s.name, COUNT(l.id) AS count
     FROM lead_sources s
     LEFT JOIN leads l ON l.source_id = s.id AND l.client_id = s.client_id
     WHERE s.client_id = ?
     GROUP BY s.id, s.name
     ORDER BY count DESC`,
    [clientId]
  );
  return rows;
}

async function monthlyVolume(clientId, months = 6) {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS count
     FROM leads
     WHERE client_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
     GROUP BY month
     ORDER BY month ASC`,
    [clientId, months]
  );
  return rows;
}

async function statusBreakdown(clientId, { restrictToUserId } = {}) {
  const clauses = ["l.client_id = ?"];
  const params = [clientId];
  if (restrictToUserId) {
    clauses.push("l.assigned_to = ?");
    params.push(restrictToUserId);
  }
  const [rows] = await pool.query(
    `SELECT st.id AS status_id, st.name, st.is_final, COUNT(l.id) AS count
     FROM lead_statuses st
     LEFT JOIN leads l ON l.status_id = st.id AND ${clauses.join(" AND ")}
     WHERE st.client_id = ?
     GROUP BY st.id, st.name, st.is_final
     ORDER BY st.sort_order ASC`,
    [...params, clientId]
  );
  return rows;
}

async function clientTotals(clientId) {
  const [[row]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(assigned_to IS NULL) AS unassigned,
       SUM(is_duplicate) AS duplicates
     FROM leads WHERE client_id = ?`,
    [clientId]
  );
  return { total: row.total, unassigned: row.unassigned || 0, duplicates: row.duplicates || 0 };
}

async function employeeTotals(clientId, userId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS assigned FROM leads WHERE client_id = ? AND assigned_to = ?`,
    [clientId, userId]
  );
  const [[calls]] = await pool.query(
    `SELECT COUNT(*) AS callsThisMonth FROM lead_activities
     WHERE client_id = ? AND user_id = ? AND type = 'call'
       AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
    [clientId, userId]
  );
  return { assigned: row.assigned, callsThisMonth: calls.callsThisMonth };
}

module.exports = {
  findById,
  findByMetaLeadId,
  findEarliestByPhoneForUpdate,
  insert,
  count,
  list,
  updateFields,
  updateStatus,
  updateAssignment,
  remove,
  sourceBreakdown,
  monthlyVolume,
  statusBreakdown,
  clientTotals,
  employeeTotals,
};
