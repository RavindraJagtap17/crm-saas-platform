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

// Super Admin manual "Retry Now" — the SAME atomic claim invariant as
// claimForProcessing above (an UPDATE whose own WHERE clause is the
// claim), with exactly one difference: a retryable 'failed' row doesn't
// need next_attempt_at <= NOW() to be claimable here. That's the whole
// point of a human clicking "retry now" instead of waiting for the
// natural backoff — but a permanently-failed row (next_attempt_at IS
// NULL) is still correctly excluded, and so is 'processing'/'processed'/
// 'duplicate', identically to claimForProcessing. Two claimers (this and
// claimForProcessing, or two concurrent manual clicks) racing for the
// same row can still never both win — only one UPDATE ever affects it.
async function claimForManualRetry(id) {
  const [result] = await pool.query(
    `UPDATE integration_events SET status = 'processing'
     WHERE id = ? AND (
       status = 'received'
       OR (status = 'failed' AND next_attempt_at IS NOT NULL)
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

// Production reliability audit finding: a row claimed into 'processing'
// (claimForProcessing above) that never reaches a terminal status —
// because the process crashed mid-processClaimedEvent, or a transient
// error occurred at the markProcessed/markDuplicate step itself, after
// the point handleProcessingFailure's own retry path stops being safe to
// use (see ingestionService.processClaimedEvent's own comment on why a
// markProcessed failure must never trigger a from-scratch retry) — is
// otherwise invisible forever: claimForProcessing's own WHERE clause only
// ever matches 'received' or a due 'failed' row, never 'processing', so
// nothing already in this codebase can reclaim it, including a server
// restart. `updated_at` (ON UPDATE CURRENT_TIMESTAMP) is what lets this
// distinguish "actually still being worked on right now" (processing
// legitimately takes milliseconds to a few seconds) from "abandoned" —
// resets it back to 'received' so the normal claim/retry path can pick
// it up again exactly as if it were newly delivered.
async function recoverStaleProcessing(staleMinutes = 15) {
  const [result] = await pool.query(
    `UPDATE integration_events SET status = 'received'
     WHERE status = 'processing' AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [staleMinutes]
  );
  return result.affectedRows;
}

// Lets a provider adapter durably record a notification BEFORE doing any
// slow/crash-risky work (an external API fetch, in LinkedIn's case) and
// then fill in the real payload once that work succeeds — see
// linkedinLeadFormService.handleWebhookEvent's own comment for why this
// specific ordering closes a real "crash between webhook receipt and
// event persistence" lead-loss window. Deliberately only touches
// raw_payload — never status/attempts/etc., so it can't interfere with
// the claim/retry state machine.
async function updateRawPayload(id, rawPayload) {
  await pool.query(`UPDATE integration_events SET raw_payload = ? WHERE id = ?`, [JSON.stringify(rawPayload), id]);
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

// Super Admin platform-wide monitoring — the ONLY place integration_events
// is ever queried across every Client at once (every other reader here is
// Client-scoped, per this table's own design). LEFT JOINs, not INNER: the
// schema deliberately allows client_id to be NULL for an event that never
// resolved to a Client at all (an unrecognized webhook token) — "exactly
// the case most worth being able to see afterward" per this table's own
// migration comment — an INNER JOIN would silently exclude precisely
// that. Never selects raw_payload or anything from integration_connections
// (credentials live there, not here, and this file never touches that
// table at all) — the list screen only ever gets the narrow columns
// actually rendered; the full row (still without credentials — there are
// none in this table) is a separate, single-row fetch (findByIdForSuperAdmin).
const SUPER_ADMIN_JOIN = `
  FROM integration_events ie
  LEFT JOIN clients c ON c.id = ie.client_id
  LEFT JOIN tenants t ON t.id = c.tenant_id
`;

function buildSuperAdminWhere({ provider, status, tenantId, clientId, search, from, to } = {}) {
  const clauses = [];
  const params = [];
  if (provider) {
    clauses.push("ie.provider = ?");
    params.push(provider);
  }
  if (status) {
    clauses.push("ie.status = ?");
    params.push(status);
  }
  if (tenantId) {
    clauses.push("c.tenant_id = ?");
    params.push(tenantId);
  }
  if (clientId) {
    clauses.push("ie.client_id = ?");
    params.push(clientId);
  }
  if (from) {
    clauses.push("ie.received_at >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("ie.received_at <= ?");
    params.push(to);
  }
  if (search) {
    const trimmed = String(search).trim();
    const asId = Number(trimmed);
    if (Number.isInteger(asId) && asId > 0 && String(asId) === trimmed) {
      // A pure integer could be either an event id or coincidentally
      // appear inside an external id — match either rather than forcing
      // the caller to know which kind of id they're searching by.
      clauses.push("(ie.id = ? OR ie.external_lead_id LIKE ?)");
      params.push(asId, `%${trimmed}%`);
    } else {
      clauses.push("ie.external_lead_id LIKE ?");
      params.push(`%${trimmed}%`);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

const SUPER_ADMIN_LIST_COLUMNS = `
  ie.id, ie.client_id, ie.provider, ie.external_lead_id, ie.event_type,
  ie.received_at, ie.processed_at, ie.status, ie.attempts, ie.next_attempt_at,
  ie.last_error, ie.crm_lead_id, ie.created_at, ie.updated_at,
  c.name AS client_name, c.tenant_id, t.name AS tenant_name
`;

async function listForSuperAdmin({ filters = {}, limit, offset } = {}) {
  const { where, params } = buildSuperAdminWhere(filters);
  const [rows] = await pool.query(
    `SELECT ${SUPER_ADMIN_LIST_COLUMNS} ${SUPER_ADMIN_JOIN} ${where} ORDER BY ie.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows;
}

async function countForSuperAdmin(filters = {}) {
  const { where, params } = buildSuperAdminWhere(filters);
  const [[row]] = await pool.query(`SELECT COUNT(*) AS count ${SUPER_ADMIN_JOIN} ${where}`, params);
  return row.count;
}

// One aggregate query, computed in the database (not by pulling every row
// into Node and counting in memory) — the same filters as the list above,
// so the summary always reflects whatever the Super Admin is currently
// looking at. "recovered" is a SUBSET of "received" (a row the stale-
// processing sweep reset back to 'received', identifiable by attempts>0
// with no dedicated status of its own — see recoverStaleProcessing's own
// comment on why this table has no separate "recovered" status), not a
// disjoint bucket — shown alongside "received", not instead of it.
// "retryPending" is a subset of "failed" (retryable, next_attempt_at set).
async function summaryForSuperAdmin(filters = {}) {
  const { where, params } = buildSuperAdminWhere(filters);
  const [[row]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN ie.status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN ie.status = 'processing' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN ie.status = 'received' THEN 1 ELSE 0 END) AS received,
       SUM(CASE WHEN ie.status = 'duplicate' THEN 1 ELSE 0 END) AS duplicate,
       SUM(CASE WHEN ie.status = 'processed' THEN 1 ELSE 0 END) AS processed,
       SUM(CASE WHEN ie.status = 'received' AND ie.attempts > 0 THEN 1 ELSE 0 END) AS recovered,
       SUM(CASE WHEN ie.status = 'failed' AND ie.next_attempt_at IS NOT NULL THEN 1 ELSE 0 END) AS retryPending
     ${SUPER_ADMIN_JOIN} ${where}`,
    params
  );
  return {
    total: Number(row.total) || 0,
    failed: Number(row.failed) || 0,
    processing: Number(row.processing) || 0,
    received: Number(row.received) || 0,
    duplicate: Number(row.duplicate) || 0,
    processed: Number(row.processed) || 0,
    recovered: Number(row.recovered) || 0,
    retryPending: Number(row.retryPending) || 0,
  };
}

// Detail view — the only Super Admin query that includes raw_payload,
// fetched separately from the list precisely so the list screen never
// pulls a potentially large JSON blob per row (Phase 10). Still no
// credentials in scope: this table has none, and integration_connections
// is never joined here.
async function findByIdForSuperAdmin(id) {
  const [rows] = await pool.query(
    `SELECT
       ie.id, ie.client_id, ie.provider, ie.external_lead_id, ie.event_type,
       ie.received_at, ie.processed_at, ie.status, ie.attempts, ie.next_attempt_at,
       ie.last_error, ie.crm_lead_id, ie.raw_payload, ie.created_at, ie.updated_at,
       c.name AS client_name, c.tenant_id, t.name AS tenant_name
     ${SUPER_ADMIN_JOIN}
     WHERE ie.id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  findById,
  findByProviderAndExternalLeadId,
  create,
  claimForProcessing,
  claimForManualRetry,
  findDueForProcessing,
  recoverStaleProcessing,
  updateRawPayload,
  markProcessed,
  markDuplicate,
  markRetryableFailure,
  markPermanentFailure,
  listForClient,
  listForSuperAdmin,
  countForSuperAdmin,
  summaryForSuperAdmin,
  findByIdForSuperAdmin,
};
