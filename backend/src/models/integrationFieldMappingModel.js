const pool = require("../config/db");

async function listForClient(clientId, provider, externalFormId) {
  const params = [clientId, provider];
  let sql = `SELECT id, client_id, provider, external_form_id, external_field_key, crm_field_key, created_at, updated_at
             FROM integration_field_mappings WHERE client_id = ? AND provider = ?`;
  if (externalFormId) {
    sql += ` AND external_form_id = ?`;
    params.push(externalFormId);
  }
  sql += ` ORDER BY external_form_id, external_field_key`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Used by the ingestion path — every raw external field key for a given
// client+provider+form, keyed for O(1) lookup while walking the
// provider's own field list. Mirrors metaFormFieldMappingModel.mapForForm
// exactly, one level more generic.
async function mapForForm(clientId, provider, externalFormId) {
  const rows = await listForClient(clientId, provider, externalFormId);
  const map = new Map();
  rows.forEach((r) => map.set(r.external_field_key, r.crm_field_key));
  return map;
}

async function findById(clientId, id) {
  const [rows] = await pool.query(
    `SELECT id, client_id, provider, external_form_id, external_field_key, crm_field_key FROM integration_field_mappings
     WHERE id = ? AND client_id = ? LIMIT 1`,
    [id, clientId]
  );
  return rows[0] || null;
}

async function create(clientId, provider, { externalFormId, externalFieldKey, crmFieldKey }) {
  const [result] = await pool.query(
    `INSERT INTO integration_field_mappings (client_id, provider, external_form_id, external_field_key, crm_field_key)
     VALUES (?, ?, ?, ?, ?)`,
    [clientId, provider, externalFormId, externalFieldKey, crmFieldKey]
  );
  return findById(clientId, result.insertId);
}

async function update(clientId, id, { crmFieldKey }) {
  const [result] = await pool.query(
    `UPDATE integration_field_mappings SET crm_field_key = ? WHERE id = ? AND client_id = ?`,
    [crmFieldKey, id, clientId]
  );
  if (result.affectedRows === 0) return null;
  return findById(clientId, id);
}

async function remove(clientId, id) {
  const [result] = await pool.query(`DELETE FROM integration_field_mappings WHERE id = ? AND client_id = ?`, [id, clientId]);
  return result.affectedRows > 0;
}

module.exports = { listForClient, mapForForm, findById, create, update, remove };
