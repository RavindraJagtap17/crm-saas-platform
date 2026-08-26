const crypto = require("crypto");
const pool = require("../config/db");

const COLUMNS = `
  id, tenant_id, form_key, name, source_id, product_id, allowed_domains,
  is_active, created_at, updated_at
`;

function generateFormKey() {
  return crypto.randomBytes(16).toString("hex"); // 32 hex chars, opaque and unguessable
}

// Public lookup — deliberately NOT tenant-scoped, since resolving the
// tenant is exactly what this does for the public API (§A).
async function findByKey(formKey) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM web_forms WHERE form_key = ? LIMIT 1`, [formKey]);
  return rows[0] || null;
}

async function listByTenant(tenantId) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM web_forms WHERE tenant_id = ? ORDER BY created_at DESC`,
    [tenantId]
  );
  return rows;
}

async function findById(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM web_forms WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function create(tenantId, { name, sourceId, productId, allowedDomains }) {
  const formKey = generateFormKey();
  const [result] = await pool.query(
    `INSERT INTO web_forms (tenant_id, form_key, name, source_id, product_id, allowed_domains, is_active)
     VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
    [tenantId, formKey, name, sourceId, productId ?? null, JSON.stringify(allowedDomains)]
  );
  return findById(tenantId, result.insertId);
}

async function update(tenantId, id, { name, sourceId, productId, allowedDomains, isActive }) {
  const [result] = await pool.query(
    `UPDATE web_forms SET
       name = COALESCE(?, name),
       source_id = COALESCE(?, source_id),
       product_id = ?,
       allowed_domains = COALESCE(?, allowed_domains),
       is_active = COALESCE(?, is_active)
     WHERE id = ? AND tenant_id = ?`,
    [
      name ?? null,
      sourceId ?? null,
      productId === undefined ? await currentProductId(tenantId, id) : productId,
      allowedDomains ? JSON.stringify(allowedDomains) : null,
      isActive === undefined ? null : !!isActive,
      id,
      tenantId,
    ]
  );
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id);
}

async function currentProductId(tenantId, id) {
  const existing = await findById(tenantId, id);
  return existing ? existing.product_id : null;
}

module.exports = { findByKey, listByTenant, findById, create, update };
