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

// Retry History (Integration Monitoring) is the first reader this table
// has ever had — added here, generically by (entity_type, entity_id),
// rather than as a one-off query living in integrationMonitoringService,
// so any future "show me the audit trail for this X" screen reuses the
// same two functions instead of hand-rolling its own. idx_audit_logs_entity
// (entity_type, entity_id) already covers the WHERE; created_at DESC is a
// filesort over whatever that index narrows down to, which is fine at the
// realistic size of a manual-action trail for one entity (single digits to
// low tens of rows, never the whole table) — see the model's own read
// function for anything close to real pagination-at-scale (integration
// events' own listForSuperAdmin), which this deliberately does not need to
// match. LEFT JOIN (not INNER), matching leadActivityModel/
// leadStatusHistoryModel's own precedent for "who did this" — a user row
// is never actually deleted (fk_audit_logs_user is ON DELETE RESTRICT), but
// LEFT JOIN costs nothing here and is the established pattern.
async function listForEntity({ entityType, entityId, limit, offset }) {
  const [rows] = await pool.query(
    `SELECT al.id, al.tenant_id, al.user_id, al.action, al.entity_type, al.entity_id, al.meta, al.created_at,
            u.name AS user_name, u.email AS user_email, r.name AS user_role
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE al.entity_type = ? AND al.entity_id = ?
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ? OFFSET ?`,
    [entityType, entityId, limit, offset]
  );
  return rows;
}

async function countForEntity({ entityType, entityId }) {
  const [[row]] = await pool.query(`SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type = ? AND entity_id = ?`, [entityType, entityId]);
  return row.count;
}

module.exports = { create, listForEntity, countForEntity };
