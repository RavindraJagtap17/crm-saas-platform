const pool = require("../config/db");

// Single write path for the platform audit trail — no read/list function
// is exposed here because no UI or API surface for viewing audit logs was
// requested; querying the table directly (DB access) is sufficient for
// what's actually required right now.
async function create({ tenantId, userId, action, entityType, entityId, meta }) {
  await pool.query(
    `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, meta) VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId ?? null, userId, action, entityType, entityId, meta ? JSON.stringify(meta) : null]
  );
}

module.exports = { create };
