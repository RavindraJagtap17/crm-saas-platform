const pool = require("../config/db");
const clientModel = require("./clientModel");

// tenant_id is still NOT NULL/no-default on this table (Phase B additive
// strategy) — create() populates it, resolved from client_id, purely to
// satisfy that constraint; never read back or used for scoping.

async function listForClient(clientId, metaFormId) {
  const params = [clientId];
  let sql = `SELECT id, client_id, meta_form_id, meta_field_key, crm_field_key, created_at, updated_at
             FROM meta_form_field_mappings WHERE client_id = ?`;
  if (metaFormId) {
    sql += ` AND meta_form_id = ?`;
    params.push(metaFormId);
  }
  sql += ` ORDER BY meta_form_id, meta_field_key`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Used by the ingestion path — every raw Meta field key for a given
// client+form, keyed for O(1) lookup while walking field_data.
async function mapForForm(clientId, metaFormId) {
  const rows = await listForClient(clientId, metaFormId);
  const map = new Map();
  rows.forEach((r) => map.set(r.meta_field_key, r.crm_field_key));
  return map;
}

async function findById(clientId, id) {
  const [rows] = await pool.query(
    `SELECT id, client_id, meta_form_id, meta_field_key, crm_field_key FROM meta_form_field_mappings
     WHERE id = ? AND client_id = ? LIMIT 1`,
    [id, clientId]
  );
  return rows[0] || null;
}

async function create(clientId, { metaFormId, metaFieldKey, crmFieldKey }) {
  const tenantId = await clientModel.findTenantIdForClient(clientId);
  const [result] = await pool.query(
    `INSERT INTO meta_form_field_mappings (tenant_id, client_id, meta_form_id, meta_field_key, crm_field_key)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, clientId, metaFormId, metaFieldKey, crmFieldKey]
  );
  return findById(clientId, result.insertId);
}

async function update(clientId, id, { crmFieldKey }) {
  const [result] = await pool.query(
    `UPDATE meta_form_field_mappings SET crm_field_key = ? WHERE id = ? AND client_id = ?`,
    [crmFieldKey, id, clientId]
  );
  if (result.affectedRows === 0) return null;
  return findById(clientId, id);
}

async function remove(clientId, id) {
  const [result] = await pool.query(`DELETE FROM meta_form_field_mappings WHERE id = ? AND client_id = ?`, [id, clientId]);
  return result.affectedRows > 0;
}

module.exports = { listForClient, mapForForm, findById, create, update, remove };
