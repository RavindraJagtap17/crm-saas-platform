const pool = require("../config/db");

const COLUMNS = `
  id, client_id, provider, external_lead_id, event_type, received_at,
  processed_at, status, attempts, next_attempt_at, last_error, crm_lead_id,
  raw_payload, created_at, updated_at
`;

async function findById(id) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM integration_events WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

// §6 idempotency lookup — the ONLY place "have we already seen this
// external lead from this provider" is answered from. Backed by
// uq_integration_events_provider_external_lead, the real backstop against
// the race between two near-simultaneous deliveries of the same event.
async function findByProviderAndExternalLeadId(provider, externalLeadId) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM integration_events WHERE provider = ? AND external_lead_id = ? LIMIT 1`, [provider, externalLeadId]);
  return rows[0] || null;
}

// INSERT IGNORE against the UNIQUE(provider, external_lead_id) constraint
// — if a row already exists (a concurrent delivery won the race), this is
// a silent no-op returning null, exactly like meta_capi_events.
// queueIfAbsent's own precedent; the caller re-reads via
// findByProviderAndExternalLeadId when this returns null.
async function create({ clientId, provider, externalLeadId, eventType, rawPayload }) {
  const [result] = await pool.query(
    `INSERT IGNORE INTO integration_events (client_id, provider, external_lead_id, event_type, raw_payload)
     VALUES (?, ?, ?, ?, ?)`,
    [clientId ?? null, provider, externalLeadId, eventType ?? null, rawPayload !== undefined ? JSON.stringify(rawPayload) : null]
  );
  if (result.affectedRows === 0) return null;
  return findById(result.insertId);
}

/**
 * Atomically claims one event for processing. The status ENUM here has
 * no separate failed_temporary/failed_permanent split (unlike
 * meta_capi_events) — a single 'failed' status serves both, distinguished
 * by next_attempt_at: a 'received' row is always claimable immediately
 * (its first attempt, next_attempt_at is never set); a 'failed' row is
 * only claimable once next_attempt_at is a real, due timestamp — a
 * permanently-failed row (status='failed', next_attempt_at left NULL by
 * markPermanentFailure) can never satisfy that second branch, so it's
 * correctly excluded without needing a 6th status value.
 *
 * The UPDATE's WHERE clause IS the claim — only a row still in a
 * processable state flips to 'processing', so two overlapping callers
 * (e.g. the startup sweep racing an immediate post-webhook trigger) can
 * never both pick up the same row. Returns false for "already claimed by
 * someone else", "not yet due", or "not in a claimable state" alike —
 * the caller doesn't need to distinguish those.
 */
async function claimForProcessing(id) {
  const [result] = await pool.query(
    `UPDATE integration_events SET status = 'processing'
     WHERE id = ? AND (
       status = 'received'
       OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW())
     )`,
    [id]
  );
  return result.affectedRows > 0;
}

async function findDueForProcessing(limit = 50) {
  const [rows] = await pool.query(
    `SELECT id FROM integration_events
     WHERE status = 'received' OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW())
     ORDER BY id ASC LIMIT ?`,
    [limit]
  );
  return rows.map((r) => r.id);
}

async function markProcessed(id, { crmLeadId }) {
  await pool.query(
    `UPDATE integration_events SET status = 'processed', processed_at = NOW(), crm_lead_id = ?, last_error = NULL WHERE id = ?`,
    [crmLeadId ?? null, id]
  );
}

// A "duplicate" outcome still records processed_at/crm_lead_id (pointing
// at the ALREADY-existing lead, for traceability) — it's a terminal,
// successful-in-the-sense-of-"nothing left to do" outcome, not a failure.
async function markDuplicate(id, { crmLeadId }) {
  await pool.query(
    `UPDATE integration_events SET status = 'duplicate', processed_at = NOW(), crm_lead_id = ?, last_error = NULL WHERE id = ?`,
    [crmLeadId ?? null, id]
  );
}

// Retryable failure — next_attempt_at is set to a real future timestamp,
// which is what makes this row claimable again later (see
// claimForProcessing's own comment).
async function markRetryableFailure(id, { attempts, nextAttemptAt, lastError }) {
  await pool.query(
    `UPDATE integration_events SET status = 'failed', attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`,
    [attempts, nextAttemptAt, lastError ?? null, id]
  );
}

// Permanent failure — next_attempt_at is explicitly cleared to NULL,
// which is what makes claimForProcessing correctly refuse to ever pick
// this row up again.
async function markPermanentFailure(id, { attempts, lastError }) {
  await pool.query(
    `UPDATE integration_events SET status = 'failed', attempts = ?, next_attempt_at = NULL, last_error = ? WHERE id = ?`,
    [attempts, lastError ?? null, id]
  );
}

// Client Admin visibility (§9/§10 of the design doc) — recent events for
// the caller's own client only.
async function listForClient(clientId, provider, limit = 50) {
  const params = [clientId];
  let sql = `SELECT ${COLUMNS} FROM integration_events WHERE client_id = ?`;
  if (provider) {
    sql += ` AND provider = ?`;
    params.push(provider);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = {
  findById,
  findByProviderAndExternalLeadId,
  create,
  claimForProcessing,
  findDueForProcessing,
  markProcessed,
  markDuplicate,
  markRetryableFailure,
  markPermanentFailure,
  listForClient,
};
