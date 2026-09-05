const pool = require("../config/db");
const clientModel = require("./clientModel");

// tenant_id is still NOT NULL/no-default on this table (Phase B additive
// strategy) — queueIfAbsent() populates it, resolved from client_id,
// purely to satisfy that constraint; never read back or used for scoping.
const COLUMNS = `
  id, client_id, lead_id, event_name, meta_event_id, status, retry_count,
  next_attempt_at, last_error, meta_response_code, sent_at, created_at, updated_at
`;

async function findById(id) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM meta_capi_events WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function findByLead(clientId, leadId) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM meta_capi_events WHERE client_id = ? AND lead_id = ? LIMIT 1`,
    [clientId, leadId]
  );
  return rows[0] || null;
}

// §H idempotency: INSERT IGNORE against the (client_id, lead_id) UNIQUE
// key — if a row already exists for this lead (an earlier final-status
// transition already queued one), this is a silent no-op, not an error.
// Runs inside the caller's transaction (leadService.changeStatus) so
// queuing is atomic with the status change itself.
async function queueIfAbsent(conn, clientId, leadId, { eventName, metaEventId }) {
  const runner = conn || pool;
  const tenantId = await clientModel.findTenantIdForClient(clientId);
  const [result] = await runner.query(
    `INSERT IGNORE INTO meta_capi_events (tenant_id, client_id, lead_id, event_name, meta_event_id, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [tenantId, clientId, leadId, eventName, metaEventId]
  );
  if (result.affectedRows === 0) return null; // already existed — not queued again
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM meta_capi_events WHERE id = ?`, [result.insertId]);
  return rows[0];
}

// Atomically claims one due event for processing — the UPDATE's WHERE
// clause is the "claim": only a row still in a processable state gets
// flipped to 'processing', so two overlapping worker ticks (e.g. the
// startup sweep racing an immediate post-status-change trigger) can never
// both pick up the same row.
async function claimForProcessing(id) {
  const [result] = await pool.query(
    `UPDATE meta_capi_events SET status = 'processing'
     WHERE id = ? AND status IN ('pending', 'failed_temporary') AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())`,
    [id]
  );
  return result.affectedRows > 0;
}

async function findDueForProcessing(limit = 50) {
  const [rows] = await pool.query(
    `SELECT id FROM meta_capi_events
     WHERE status IN ('pending', 'failed_temporary') AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
     ORDER BY id ASC LIMIT ?`,
    [limit]
  );
  return rows.map((r) => r.id);
}

async function markSent(id, { metaResponseCode }) {
  await pool.query(
    `UPDATE meta_capi_events SET status = 'sent', sent_at = NOW(), meta_response_code = ?, last_error = NULL WHERE id = ?`,
    [metaResponseCode ?? null, id]
  );
}

async function markTemporaryFailure(id, { retryCount, nextAttemptAt, lastError, metaResponseCode }) {
  await pool.query(
    `UPDATE meta_capi_events SET status = 'failed_temporary', retry_count = ?, next_attempt_at = ?, last_error = ?, meta_response_code = ? WHERE id = ?`,
    [retryCount, nextAttemptAt, lastError, metaResponseCode ?? null, id]
  );
}

async function markPermanentFailure(id, { retryCount, lastError, metaResponseCode }) {
  await pool.query(
    `UPDATE meta_capi_events SET status = 'failed_permanent', retry_count = ?, next_attempt_at = NULL, last_error = ?, meta_response_code = ? WHERE id = ?`,
    [retryCount, lastError, metaResponseCode ?? null, id]
  );
}

// §K admin visibility — recent events for the caller's own client only.
async function listForClient(clientId, limit = 50) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM meta_capi_events WHERE client_id = ? ORDER BY id DESC LIMIT ?`,
    [clientId, limit]
  );
  return rows;
}

module.exports = {
  findById,
  findByLead,
  queueIfAbsent,
  claimForProcessing,
  findDueForProcessing,
  markSent,
  markTemporaryFailure,
  markPermanentFailure,
  listForClient,
};
