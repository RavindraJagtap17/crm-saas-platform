const pool = require("../config/db");
const clientModel = require("./clientModel");

// tenant_id is still NOT NULL/no-default on this table (Phase B additive
// strategy) — the INSERT branch of upsert() below populates it, resolved
// from client_id, purely to satisfy that constraint; never read back or
// used for scoping.
const COLUMNS = `
  id, client_id, ad_account_id, page_id, page_name, pixel_id,
  access_token_encrypted, token_expires_at, created_at, updated_at
`;

async function findByClient(clientId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM meta_integration_settings WHERE client_id = ? LIMIT 1`, [clientId]);
  return rows[0] || null;
}

// The client-resolution lookup (§D): page_id -> client. This is the ONLY
// place a webhook event's client is ever determined from.
async function findByPageId(pageId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM meta_integration_settings WHERE page_id = ? LIMIT 1`, [pageId]);
  return rows[0] || null;
}

async function upsert(clientId, { adAccountId, pageId, pageName, accessTokenEncrypted, tokenExpiresAt }) {
  const existing = await findByClient(clientId);
  if (existing) {
    await pool.query(
      `UPDATE meta_integration_settings SET
         ad_account_id = ?, page_id = ?, page_name = ?, access_token_encrypted = ?, token_expires_at = ?
       WHERE client_id = ?`,
      [adAccountId ?? null, pageId, pageName ?? null, accessTokenEncrypted, tokenExpiresAt ?? null, clientId]
    );
  } else {
    const tenantId = await clientModel.findTenantIdForClient(clientId);
    await pool.query(
      `INSERT INTO meta_integration_settings
         (tenant_id, client_id, ad_account_id, page_id, page_name, access_token_encrypted, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, clientId, adAccountId ?? null, pageId, pageName ?? null, accessTokenEncrypted, tokenExpiresAt ?? null]
    );
  }
  return findByClient(clientId);
}

async function remove(clientId) {
  const [result] = await pool.query(`DELETE FROM meta_integration_settings WHERE client_id = ?`, [clientId]);
  return result.affectedRows > 0;
}

// Step 8: the Client Admin enters this manually (see the migration 016
// comment for why OAuth can't reliably discover it) — a plain scalar
// update on the existing connection row, not a second connection.
async function setPixelId(clientId, pixelId) {
  const [result] = await pool.query(`UPDATE meta_integration_settings SET pixel_id = ? WHERE client_id = ?`, [
    pixelId,
    clientId,
  ]);
  if (result.affectedRows === 0) return null;
  return findByClient(clientId);
}

module.exports = { findByClient, findByPageId, upsert, remove, setPixelId };
