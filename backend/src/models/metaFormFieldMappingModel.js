const pool = require("../config/db");

async function listForTenant(tenantId, metaFormId) {
  const params = [tenantId];
  let sql = `SELECT id, tenant_id, meta_form_id, meta_field_key, crm_field_key, created_at, updated_at
             FROM meta_form_field_mappings WHERE tenant_id = ?`;
  if (metaFormId) {
    sql += ` AND meta_form_id = ?`;
    params.push(metaFormId);
  }
  sql += ` ORDER BY meta_form_id, meta_field_key`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Used by the ingestion path — every raw Meta field key for a given
// tenant+form, keyed for O(1) lookup while walking field_data.
async function mapForForm(tenantId, metaFormId) {
  const rows = await listForTenant(tenantId, metaFormId);
  const map = new Map();
  rows.forEach((r) => map.set(r.meta_field_key, r.crm_field_key));
  return map;
}

async function findById(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, meta_form_id, meta_field_key, crm_field_key FROM meta_form_field_mappings
     WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function create(tenantId, { metaFormId, metaFieldKey, crmFieldKey }) {
  const [result] = await pool.query(
    `INSERT INTO meta_form_field_mappings (tenant_id, meta_form_id, meta_field_key, crm_field_key)
     VALUES (?, ?, ?, ?)`,
    [tenantId, metaFormId, metaFieldKey, crmFieldKey]
  );
  return findById(tenantId, result.insertId);
}

async function update(tenantId, id, { crmFieldKey }) {
  const [result] = await pool.query(
    `UPDATE meta_form_field_mappings SET crm_field_key = ? WHERE id = ? AND tenant_id = ?`,
    [crmFieldKey, id, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id);
}

async function remove(tenantId, id) {
  const [result] = await pool.query(`DELETE FROM meta_form_field_mappings WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return result.affectedRows > 0;
}

module.exports = { listForTenant, mapForForm, findById, create, update, remove };
