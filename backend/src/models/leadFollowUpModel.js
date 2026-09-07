const pool = require("../config/db");

const BASE_COLUMNS = `
  id, client_id, lead_id, assigned_to, scheduled_at, status, notes,
  created_by, completed_at, completed_by, cancelled_at, created_at, updated_at
`;

// Mirrors leadModel's own scope helpers exactly: an optional
// restrictToUserId, baked directly into the WHERE clause so an
// out-of-scope row is indistinguishable from a nonexistent one. Here it
// restricts to the employee's OWN assigned follow-ups (see
// leadFollowUpService's header comment for why "assigned_to = self" is
// the chosen employee-scoping rule).
function scopeClause({ restrictToUserId } = {}, prefix = "") {
  return restrictToUserId ? `AND ${prefix}assigned_to = ?` : "";
}
function scopeParams({ restrictToUserId } = {}) {
  return restrictToUserId ? [restrictToUserId] : [];
}

// `prefix` lets list() below reuse the exact same filter logic against a
// joined query (aliased "fu.") while count()/others use it unaliased.
function buildFilterWhere(clientId, { restrictToUserId, filters = {} } = {}, prefix = "") {
  const clauses = [`${prefix}client_id = ?`];
  const params = [clientId];

  if (restrictToUserId) {
    clauses.push(`${prefix}assigned_to = ?`);
    params.push(restrictToUserId);
  } else if (filters.assignedTo) {
    clauses.push(`${prefix}assigned_to = ?`);
    params.push(filters.assignedTo);
  }
  if (filters.leadId) {
    clauses.push(`${prefix}lead_id = ?`);
    params.push(filters.leadId);
  }
  if (filters.overdue) {
    // Overdue is always a subset of pending — never stored, always
    // derived at query time (see migration 056's own header comment).
    clauses.push(`${prefix}status = 'pending' AND ${prefix}scheduled_at < NOW()`);
  } else if (filters.status) {
    clauses.push(`${prefix}status = ?`);
    params.push(filters.status);
  }
  if (filters.dateFrom) {
    clauses.push(`${prefix}scheduled_at >= ?`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    clauses.push(`${prefix}scheduled_at <= ?`);
    params.push(filters.dateTo);
  }

  return { where: clauses.join(" AND "), params };
}

async function findById(clientId, id, scope = {}) {
  const [rows] = await pool.query(
    `SELECT ${BASE_COLUMNS} FROM lead_follow_ups WHERE id = ? AND client_id = ? ${scopeClause(scope)} LIMIT 1`,
    [id, clientId, ...scopeParams(scope)]
  );
  return rows[0] || null;
}

async function count(clientId, opts = {}) {
  const { where, params } = buildFilterWhere(clientId, opts);
  const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM lead_follow_ups WHERE ${where}`, params);
  return rows[0].total;
}

const LIST_COLUMNS = `
  fu.id, fu.client_id, fu.lead_id, fu.assigned_to, fu.scheduled_at, fu.status, fu.notes,
  fu.created_by, fu.completed_at, fu.completed_by, fu.cancelled_at, fu.created_at, fu.updated_at
`;

async function list(clientId, opts = {}) {
  const { where, params } = buildFilterWhere(clientId, opts, "fu.");
  const { limit, offset } = opts;
  const [rows] = await pool.query(
    `SELECT ${LIST_COLUMNS},
            l.name AS lead_name, l.phone AS lead_phone,
            u.name AS assigned_to_name, u.email AS assigned_to_email
     FROM lead_follow_ups fu
     JOIN leads l ON l.client_id = fu.client_id AND l.id = fu.lead_id
     JOIN users u ON u.client_id = fu.client_id AND u.id = fu.assigned_to
     WHERE ${where}
     ORDER BY fu.scheduled_at ASC, fu.id ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows;
}

async function listForLead(clientId, leadId, scope = {}) {
  const [rows] = await pool.query(
    `SELECT fu.*, u.name AS assigned_to_name, u.email AS assigned_to_email,
            cb.name AS created_by_name, comp.name AS completed_by_name
     FROM lead_follow_ups fu
     JOIN users u ON u.client_id = fu.client_id AND u.id = fu.assigned_to
     LEFT JOIN users cb ON cb.client_id = fu.client_id AND cb.id = fu.created_by
     LEFT JOIN users comp ON comp.client_id = fu.client_id AND comp.id = fu.completed_by
     WHERE fu.client_id = ? AND fu.lead_id = ? ${scopeClause(scope, "fu.")}
     ORDER BY fu.scheduled_at DESC, fu.id DESC`,
    [clientId, leadId, ...scopeParams(scope)]
  );
  return rows;
}

async function insert(conn, clientId, { leadId, assignedTo, scheduledAt, notes, createdBy }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT INTO lead_follow_ups (client_id, lead_id, assigned_to, scheduled_at, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [clientId, leadId, assignedTo, scheduledAt, notes ?? null, createdBy]
  );
  const [rows] = await runner.query(`SELECT ${BASE_COLUMNS} FROM lead_follow_ups WHERE id = ?`, [result.insertId]);
  return rows[0];
}

// Reschedule/edit — only ever called while the row is still 'pending'
// (enforced by the service layer's own read-before-write check); the
// WHERE AND status = 'pending' here is belt-and-suspenders against a
// concurrent complete/cancel racing this same update.
async function updateFields(clientId, id, patch, scope = {}) {
  const sets = [];
  const params = [];
  if (patch.assignedTo !== undefined) { sets.push("assigned_to = ?"); params.push(patch.assignedTo); }
  if (patch.scheduledAt !== undefined) { sets.push("scheduled_at = ?"); params.push(patch.scheduledAt); }
  if (patch.notes !== undefined) { sets.push("notes = ?"); params.push(patch.notes); }
  if (sets.length === 0) return findById(clientId, id, scope);

  const [result] = await pool.query(
    `UPDATE lead_follow_ups SET ${sets.join(", ")}
     WHERE id = ? AND client_id = ? AND status = 'pending' ${scopeClause(scope)}`,
    [...params, id, clientId, ...scopeParams(scope)]
  );
  if (result.affectedRows === 0) return null;
  return findById(clientId, id, scope);
}

async function complete(conn, clientId, id, completedBy, scope = {}) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE lead_follow_ups SET status = 'completed', completed_at = NOW(), completed_by = ?
     WHERE id = ? AND client_id = ? AND status = 'pending' ${scopeClause(scope)}`,
    [completedBy, id, clientId, ...scopeParams(scope)]
  );
  return result.affectedRows > 0;
}

async function cancel(clientId, id, scope = {}) {
  const [result] = await pool.query(
    `UPDATE lead_follow_ups SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = ? AND client_id = ? AND status = 'pending' ${scopeClause(scope)}`,
    [id, clientId, ...scopeParams(scope)]
  );
  return result.affectedRows > 0;
}

// ---- Dashboard aggregates — mirrors leadModel's own clientTotals/
// callsToday style exactly: grouped counts, not full row fetches.

async function dashboardCounts(clientId, { restrictToUserId } = {}) {
  const clause = scopeClause({ restrictToUserId });
  const params = scopeParams({ restrictToUserId });
  const [[row]] = await pool.query(
    `SELECT
       SUM(status = 'pending' AND DATE(scheduled_at) = CURDATE()) AS todayCount,
       SUM(status = 'pending' AND scheduled_at < NOW()) AS overdueCount,
       SUM(status = 'pending' AND scheduled_at > NOW()) AS upcomingCount,
       SUM(status = 'completed' AND DATE(completed_at) = CURDATE()) AS completedTodayCount
     FROM lead_follow_ups WHERE client_id = ? ${clause}`,
    [clientId, ...params]
  );
  // mysql2 returns SUM() of a boolean expression as a numeric STRING when
  // at least one row matches (and as null with zero rows) — see
  // leadModel.clientTotals' identical fix/comment. Number(...) normalizes
  // both cases to a real JS number.
  return {
    todayCount: Number(row.todayCount) || 0,
    overdueCount: Number(row.overdueCount) || 0,
    upcomingCount: Number(row.upcomingCount) || 0,
    completedTodayCount: Number(row.completedTodayCount) || 0,
  };
}

// Client-wide "today's follow-ups" table for the Admin dashboard (§6) —
// every pending follow-up due today, regardless of who it's assigned to.
async function todayList(clientId) {
  const [rows] = await pool.query(
    `SELECT fu.id, fu.scheduled_at, fu.status, fu.lead_id,
            l.name AS lead_name, l.phone AS lead_phone,
            u.name AS assigned_to_name
     FROM lead_follow_ups fu
     JOIN leads l ON l.client_id = fu.client_id AND l.id = fu.lead_id
     JOIN users u ON u.client_id = fu.client_id AND u.id = fu.assigned_to
     WHERE fu.client_id = ? AND fu.status = 'pending' AND DATE(fu.scheduled_at) = CURDATE()
     ORDER BY fu.scheduled_at ASC`,
    [clientId]
  );
  return rows;
}

module.exports = {
  findById,
  count,
  list,
  listForLead,
  insert,
  updateFields,
  complete,
  cancel,
  dashboardCounts,
  todayList,
};
