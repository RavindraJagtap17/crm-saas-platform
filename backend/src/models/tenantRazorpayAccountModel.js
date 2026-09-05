const pool = require("../config/db");

// access_token_encrypted / refresh_token_encrypted are deliberately
// excluded from the default column list — every ordinary read (connection
// status display, revocation lookup) uses this safe projection; only
// findByTenantWithSecrets below ever selects the encrypted blobs, and only
// for the one legitimate call site that needs them (token refresh). public_token
// (migration 049) is included here deliberately — it is NOT a secret (see
// that migration's comment: Razorpay documents it as safe for public/
// browser use, the same trust level as key_id), so unlike the encrypted
// columns it belongs in the ordinary/safe projection.
const COLUMNS = `
  id, tenant_id, razorpay_account_id, public_token, status, token_expires_at, connected_at, created_at, updated_at
`;

async function findByTenant(tenantId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM tenant_razorpay_accounts WHERE tenant_id = ? LIMIT 1`, [tenantId]);
  return rows[0] || null;
}

// Only call site: agencyRazorpayConnectService.refreshIfNeeded. Never used
// to build an HTTP response — the encrypted columns must never reach a
// serializer.
async function findByTenantWithSecrets(tenantId) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS}, access_token_encrypted, refresh_token_encrypted FROM tenant_razorpay_accounts WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  return rows[0] || null;
}

async function findByRazorpayAccountId(razorpayAccountId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM tenant_razorpay_accounts WHERE razorpay_account_id = ? LIMIT 1`, [
    razorpayAccountId,
  ]);
  return rows[0] || null;
}

// Step 8D — the ONLY call site that ever selects webhook_secret_encrypted.
// Never used to build an HTTP response, same discipline as
// findByTenantWithSecrets. Looked up by razorpay_account_id (the only
// identifier a connected-account webhook payload carries) specifically to
// find WHICH agency's secret to verify an incoming Client-payment webhook
// against — see clientPaymentWebhook.controller.js for why the lookup
// itself must happen before the payload's account_id can be trusted.
async function findByRazorpayAccountIdWithWebhookSecret(razorpayAccountId) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS}, webhook_secret_encrypted FROM tenant_razorpay_accounts WHERE razorpay_account_id = ? LIMIT 1`,
    [razorpayAccountId]
  );
  return rows[0] || null;
}

// Step 8E — the one call site agencyRazorpayConnectService.provisioning
// needs: "is a webhook already provisioned for THIS agency's current
// connection" (idempotency check before calling Razorpay's Create-a-
// Webhook API again). Never used to build an HTTP response.
async function findByTenantWithWebhookSecret(tenantId) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS}, webhook_secret_encrypted FROM tenant_razorpay_accounts WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  return rows[0] || null;
}

// Explicit get-then-branch upsert, matching this codebase's established
// convention (agencySubscriptionPlanModel, Step 4) over a single
// ON DUPLICATE KEY UPDATE statement. A re-connect (Agency Admin
// disconnects, then connects again, possibly to a different Razorpay
// account) fully replaces the row's identity and tokens — UNIQUE(tenant_id)
// guarantees only one row per agency regardless.
// clearWebhookSecret (Step 8E): true when the razorpay_account_id being
// connected DIFFERS from whatever this agency had before (a genuinely new
// connected account) — any previously-stored webhook secret belonged to
// THAT old account and would be meaningless/wrong for the new one, so it
// must be cleared here rather than left looking "already provisioned."
// The caller (agencyRazorpayConnectService.completeConnect) determines
// this by comparing against the row read just before calling upsert.
async function upsertConnected(
  tenantId,
  { razorpayAccountId, publicToken, accessTokenEncrypted, refreshTokenEncrypted, tokenExpiresAt, clearWebhookSecret }
) {
  const existing = await findByTenant(tenantId);
  if (!existing) {
    await pool.query(
      `INSERT INTO tenant_razorpay_accounts
         (tenant_id, razorpay_account_id, public_token, status, access_token_encrypted, refresh_token_encrypted, token_expires_at, connected_at)
       VALUES (?, ?, ?, 'connected', ?, ?, ?, NOW())`,
      [tenantId, razorpayAccountId, publicToken ?? null, accessTokenEncrypted, refreshTokenEncrypted, tokenExpiresAt]
    );
  } else {
    const webhookSecretClause = clearWebhookSecret ? "webhook_secret_encrypted = NULL," : "";
    await pool.query(
      `UPDATE tenant_razorpay_accounts SET
         razorpay_account_id = ?,
         public_token = ?,
         status = 'connected',
         access_token_encrypted = ?,
         refresh_token_encrypted = ?,
         token_expires_at = ?,
         ${webhookSecretClause}
         connected_at = NOW()
       WHERE tenant_id = ?`,
      [razorpayAccountId, publicToken ?? null, accessTokenEncrypted, refreshTokenEncrypted, tokenExpiresAt, tenantId]
    );
  }
  return findByTenant(tenantId);
}

// Step 8E — sets the provisioned per-account webhook secret after a
// successful Create-a-Webhook call. Scoped by tenant_id only (never by any
// request-supplied identifier), so an Agency can only ever write its OWN
// row — structurally cannot overwrite another Agency's secret.
async function setWebhookSecret(tenantId, webhookSecretEncrypted) {
  const [result] = await pool.query(`UPDATE tenant_razorpay_accounts SET webhook_secret_encrypted = ? WHERE tenant_id = ?`, [
    webhookSecretEncrypted,
    tenantId,
  ]);
  return result.affectedRows > 0;
}

// Token refresh — keeps razorpay_account_id/status/connected_at untouched;
// public_token is COALESCE'd (Razorpay's refresh_token-grant response
// includes a fresh one per its documented example, but if a caller ever
// omits it, the existing value is kept rather than wiped to NULL).
async function updateTokens(tenantId, { accessTokenEncrypted, refreshTokenEncrypted, tokenExpiresAt, publicToken }) {
  const [result] = await pool.query(
    `UPDATE tenant_razorpay_accounts SET
       access_token_encrypted = ?, refresh_token_encrypted = ?, token_expires_at = ?,
       public_token = COALESCE(?, public_token)
     WHERE tenant_id = ?`,
    [accessTokenEncrypted, refreshTokenEncrypted, tokenExpiresAt, publicToken ?? null, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findByTenant(tenantId);
}

// Revocation (Partner webhook) or an unrecoverable refresh failure — the
// row is KEPT (historical connection record, never deleted), only status
// and the now-useless token material change. Tokens are actively cleared
// (not just left stale) since a disconnected/revoked token has no further
// legitimate use.
async function markDisconnectedByAccountId(razorpayAccountId) {
  const [result] = await pool.query(
    `UPDATE tenant_razorpay_accounts SET
       status = 'disconnected',
       access_token_encrypted = NULL,
       refresh_token_encrypted = NULL,
       token_expires_at = NULL
     WHERE razorpay_account_id = ?`,
    [razorpayAccountId]
  );
  if (result.affectedRows === 0) return null;
  return findByRazorpayAccountId(razorpayAccountId);
}

async function markDisconnectedByTenant(tenantId) {
  const [result] = await pool.query(
    `UPDATE tenant_razorpay_accounts SET
       status = 'disconnected',
       access_token_encrypted = NULL,
       refresh_token_encrypted = NULL,
       token_expires_at = NULL
     WHERE tenant_id = ?`,
    [tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findByTenant(tenantId);
}

module.exports = {
  findByTenant,
  findByTenantWithSecrets,
  findByRazorpayAccountId,
  findByRazorpayAccountIdWithWebhookSecret,
  findByTenantWithWebhookSecret,
  upsertConnected,
  updateTokens,
  setWebhookSecret,
  markDisconnectedByAccountId,
  markDisconnectedByTenant,
};
