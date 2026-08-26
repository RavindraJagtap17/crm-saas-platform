const pool = require("../config/db");

async function create({ source, tenantId, eventType, payload, signatureValid, processed, error }) {
  const [result] = await pool.query(
    `INSERT INTO webhook_logs (source, tenant_id, event_type, payload, signature_valid, processed, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [source, tenantId ?? null, eventType ?? null, payload ? JSON.stringify(payload) : null, !!signatureValid, !!processed, error ?? null]
  );
  return result.insertId;
}

module.exports = { create };
