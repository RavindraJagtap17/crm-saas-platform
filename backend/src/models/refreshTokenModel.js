const pool = require("../config/db");

async function create({ userId, tokenHash, expiresAt }) {
  const [result] = await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );
  return result.insertId;
}

async function findByHash(tokenHash) {
  const [rows] = await pool.query(`SELECT * FROM refresh_tokens WHERE token_hash = ? LIMIT 1`, [tokenHash]);
  return rows[0] || null;
}

async function revoke(id) {
  await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL`, [id]);
}

// Used when a rotated-out token is presented again — treated as a signal
// the token may have been stolen, so every session for that user is cut.
async function revokeAllForUser(userId) {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
}

module.exports = { create, findByHash, revoke, revokeAllForUser };
