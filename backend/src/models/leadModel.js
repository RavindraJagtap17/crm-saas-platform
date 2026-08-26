const pool = require("../config/db");

const BASE_COLUMNS = `
  id, tenant_id, name, phone, email, source_id, product_id, status_id, assigned_to,
  custom_fields, meta_lead_id, is_duplicate, duplicate_of_lead_id, converted_at,
  created_at, updated_at
`;

// Every read here takes tenantId as a required parameter and, for an
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

async function findById(tenantId, id, scope = {}) {
  const [rows] = await pool.query(
    `SELECT ${BASE_COLUMNS} FROM leads WHERE id = ? AND tenant_id = ? ${scopeClause(scope)} LIMIT 1`,
    [id, tenantId, ...scopeParams(scope)]
  );
  return rows[0] || null;
}

// Locks any existing matching row(s) so two concurrent creations with the
// same phone number can't both see "no duplicate yet" — must be called
// inside the same transaction as the subsequent insert.
async function findEarliestByPhoneForUpdate(conn, tenantId, normalizedPhone) {
  if (!normalizedPhone) return null;
  const [rows] = await conn.query(
    `SELECT id FROM leads WHERE tenant_id = ? AND phone = ? ORDER BY id ASC LIMIT 1 FOR UPDATE`,
    [tenantId, normalizedPhone]
  );
  return rows[0] || null;
}

async function insert(conn, tenantId, lead) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT INTO leads
       (tenant_id, name, phone, email, source_id, product_id, status_id, assigned_to,
        custom_fields, is_duplicate, duplicate_of_lead_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      lead.name ?? null,
      lead.phone ?? null,
      lead.email ?? null,
      lead.sourceId ?? null,
      lead.productId ?? null,
      lead.statusId ?? null,
      lead.assignedTo ?? null,
      lead.customFields ? JSON.stringify(lead.customFields) : null,
      !!lead.isDuplicate,
      lead.duplicateOfLeadId ?? null,
    ]
  );
  const [rows] = await runner.query(`SELECT ${BASE_COLUMNS} FROM leads WHERE id = ?`, [result.insertId]);
  return rows[0];
}

async function count(tenantId, { restrictToUserId, filters = {} } = {}) {
  const { where, params } = buildFilterWhere(tenantId, { restrictToUserId, filters });
  const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM leads WHERE ${where}`, params);
  return rows[0].total;
}

async function list(tenantId, { restrictToUserId, filters = {}, limit, offset } = {}) {
  const { where, params } = buildFilterWhere(tenantId, { restrictToUserId, filters });
  const [rows] = await pool.query(
    `SELECT ${BASE_COLUMNS} FROM leads WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows;
}

function buildFilterWhere(tenantId, { restrictToUserId, filters }) {
  const clauses = ["tenant_id = ?"];
  const params = [tenantId];

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

  return { where: clauses.join(" AND "), params };
}

// Only ever touches the plain, non-side-effecting fields. Status and
// assignment changes go through updateStatus/updateAssignment because
// each of those requires writing a companion history/activity row.
async function updateFields(tenantId, id, patch, scope = {}) {
  const sets = [];
  const params = [];

  if (patch.name !== undefined) { sets.push("name = ?"); params.push(patch.name); }
  if (patch.phone !== undefined) { sets.push("phone = ?"); params.push(patch.phone); }
  if (patch.email !== undefined) { sets.push("email = ?"); params.push(patch.email); }
  if (patch.sourceId !== undefined) { sets.push("source_id = ?"); params.push(patch.sourceId); }
  if (patch.productId !== undefined) { sets.push("product_id = ?"); params.push(patch.productId); }
  if (patch.customFields !== undefined) { sets.push("custom_fields = ?"); params.push(JSON.stringify(patch.customFields)); }

  if (sets.length === 0) return findById(tenantId, id, scope);

  const [result] = await pool.query(
    `UPDATE leads SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ? ${scopeClause(scope)}`,
    [...params, id, tenantId, ...scopeParams(scope)]
  );
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id, scope);
}

async function updateStatus(conn, tenantId, id, statusId, scope = {}) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE leads SET status_id = ? WHERE id = ? AND tenant_id = ? ${scopeClause(scope)}`,
    [statusId, id, tenantId, ...scopeParams(scope)]
  );
  return result.affectedRows > 0;
}

async function updateAssignment(conn, tenantId, id, assignedTo) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE leads SET assigned_to = ? WHERE id = ? AND tenant_id = ?`,
    [assignedTo, id, tenantId]
  );
  return result.affectedRows > 0;
}

async function remove(tenantId, id) {
  const [result] = await pool.query(`DELETE FROM leads WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return result.affectedRows > 0;
}

module.exports = {
  findById,
  findEarliestByPhoneForUpdate,
  insert,
  count,
  list,
  updateFields,
  updateStatus,
  updateAssignment,
  remove,
};
