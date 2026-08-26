const pool = require("../config/db");

const COLUMNS = `
  id, tenant_id, ad_account_id, page_id, page_name, pixel_id,
  access_token_encrypted, token_expires_at, created_at, updated_at
`;

async function findByTenant(tenantId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM meta_integration_settings WHERE tenant_id = ? LIMIT 1`, [tenantId]);
  return rows[0] || null;
}

// The tenant-resolution lookup (§D): page_id -> tenant. This is the ONLY
// place a webhook event's tenant is ever determined from.
async function findByPageId(pageId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM meta_integration_settings WHERE page_id = ? LIMIT 1`, [pageId]);
  return rows[0] || null;
}

async function upsert(tenantId, { adAccountId, pageId, pageName, accessTokenEncrypted, tokenExpiresAt }) {
  const existing = await findByTenant(tenantId);
  if (existing) {
    await pool.query(
      `UPDATE meta_integration_settings SET
         ad_account_id = ?, page_id = ?, page_name = ?, access_token_encrypted = ?, token_expires_at = ?
       WHERE tenant_id = ?`,
      [adAccountId ?? null, pageId, pageName ?? null, accessTokenEncrypted, tokenExpiresAt ?? null, tenantId]
    );
  } else {
    await pool.query(
      `INSERT INTO meta_integration_settings
         (tenant_id, ad_account_id, page_id, page_name, access_token_encrypted, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId, adAccountId ?? null, pageId, pageName ?? null, accessTokenEncrypted, tokenExpiresAt ?? null]
    );
  }
  return findByTenant(tenantId);
}

async function remove(tenantId) {
  const [result] = await pool.query(`DELETE FROM meta_integration_settings WHERE tenant_id = ?`, [tenantId]);
  return result.affectedRows > 0;
}

// Step 8: the Tenant Admin enters this manually (see the migration 016
// comment for why OAuth can't reliably discover it) — a plain scalar
// update on the existing connection row, not a second connection.
async function setPixelId(tenantId, pixelId) {
  const [result] = await pool.query(`UPDATE meta_integration_settings SET pixel_id = ? WHERE tenant_id = ?`, [
    pixelId,
    tenantId,
  ]);
  if (result.affectedRows === 0) return null;
  return findByTenant(tenantId);
}

module.exports = { findByTenant, findByPageId, upsert, remove, setPixelId };
