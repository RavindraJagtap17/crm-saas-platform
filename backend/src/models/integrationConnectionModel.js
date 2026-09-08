const pool = require("../config/db");

const COLUMNS = `
  id, client_id, provider, external_account_id, status,
  credentials_encrypted, config, created_at, updated_at
`;

async function findByClientAndProvider(clientId, provider) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM integration_connections WHERE client_id = ? AND provider = ? LIMIT 1`, [clientId, provider]);
  return rows[0] || null;
}

// The client-resolution lookup (§6/§7 of the design doc): provider +
// external_account_id -> client. This is the ONLY place a future
// provider's webhook/API event scope should ever be determined from —
// never from anything in the inbound request itself. Mirrors
// metaIntegrationModel.findByPageId exactly, one level more generic.
async function findByProviderAndAccount(provider, externalAccountId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM integration_connections WHERE provider = ? AND external_account_id = ? LIMIT 1`, [provider, externalAccountId]);
  return rows[0] || null;
}

// One row per (client, provider) — a reconnect overwrites the existing
// row in place rather than creating a second one, matching
// meta_integration_settings.upsert's identical "one connection per
// client" shape.
async function upsert(clientId, provider, { externalAccountId, status, credentialsEncrypted, config }) {
  const existing = await findByClientAndProvider(clientId, provider);
  if (existing) {
    await pool.query(
      `UPDATE integration_connections SET
         external_account_id = COALESCE(?, external_account_id), status = COALESCE(?, status),
         credentials_encrypted = COALESCE(?, credentials_encrypted),
         config = COALESCE(?, config)
       WHERE id = ?`,
      [externalAccountId ?? null, status ?? null, credentialsEncrypted ?? null, config !== undefined ? JSON.stringify(config) : null, existing.id]
    );
  } else {
    await pool.query(
      `INSERT INTO integration_connections (client_id, provider, external_account_id, status, credentials_encrypted, config)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [clientId, provider, externalAccountId, status || "connected", credentialsEncrypted ?? null, config !== undefined ? JSON.stringify(config) : null]
    );
  }
  return findByClientAndProvider(clientId, provider);
}

async function updateStatus(clientId, provider, status) {
  const [result] = await pool.query(`UPDATE integration_connections SET status = ? WHERE client_id = ? AND provider = ?`, [status, clientId, provider]);
  if (result.affectedRows === 0) return null;
  return findByClientAndProvider(clientId, provider);
}

async function remove(clientId, provider) {
  const [result] = await pool.query(`DELETE FROM integration_connections WHERE client_id = ? AND provider = ?`, [clientId, provider]);
  return result.affectedRows > 0;
}

module.exports = { findByClientAndProvider, findByProviderAndAccount, upsert, updateStatus, remove };
