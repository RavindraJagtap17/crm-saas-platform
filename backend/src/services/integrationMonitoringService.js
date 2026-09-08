const integrationEventModel = require("../models/integrationEventModel");
const auditLogModel = require("../models/auditLogModel");
const ingestionService = require("./ingestionService");
const httpError = require("../utils/httpError");
const logger = require("../utils/logger");
const { parsePagination } = require("../utils/pagination");
const { validateEventFilters } = require("../validators/integrationMonitoringValidators");

// Defense-in-depth redaction for the ONE screen in this app that shows a
// raw_payload's full contents (every other reader — the Client-facing
// Recent Events pages, ingestionService itself — never returns raw_payload
// to a browser at all). Nothing currently written into raw_payload by any
// adapter (Meta doesn't use this table at all; Google/LinkedIn/IndiaMART
// were all audited to confirm neither their webhook key/shared secret nor
// any OAuth token is ever included — see each provider's own test suite)
// actually contains a secret, but this exists so a future provider
// adapter accidentally including one doesn't silently reach a Super
// Admin's browser. Matches on the KEY name, not the value — deliberately
// narrow substrings (not bare "key", which would false-positive on
// legitimate field names like external_field_key/crm_field_key already
// used throughout this exact payload shape).
const SENSITIVE_KEY_PATTERN = /token|secret|password|credential|authorization|signature/i;
const REDACTED = "[redacted]";

function redactPayload(value) {
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactPayload(val);
    }
    return out;
  }
  return value;
}

const PROVIDER_LABELS = { meta: "Meta", google: "Google Ads", linkedin: "LinkedIn", indiamart: "IndiaMART" };
function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider;
}

// Phase 12 — a short, human-readable line for the list screen (never a
// stack trace, never the raw error string here; the full last_error is
// still available in the detail view). Driven by the same state-machine
// facts the Client-facing pages already surface (status/attempts/
// next_attempt_at), not by pattern-matching last_error's own free text,
// which would be fragile and could misclassify.
function summarize(row) {
  const p = providerLabel(row.provider);
  if (row.status === "processed") return `${p} event processed successfully.`;
  if (row.status === "duplicate") return `${p} event was a duplicate delivery — no new lead created.`;
  if (row.status === "processing") return `${p} event is currently being processed.`;
  if (row.status === "received" && row.attempts > 0) return `${p} event was recovered after getting stuck — awaiting reprocessing.`;
  if (row.status === "received") return `${p} event received, awaiting processing.`;
  if (row.status === "failed" && row.next_attempt_at) return `${p} processing failed — retry pending (${row.attempts} attempt${row.attempts === 1 ? "" : "s"} so far).`;
  if (row.status === "failed") return `${p} processing permanently failed after ${row.attempts} attempt${row.attempts === 1 ? "" : "s"}.`;
  return `${p} event: ${row.status}.`;
}

// "recovered" is the same "reset back to 'received' by the stale-
// processing sweep, identifiable by attempts>0" derivation used
// everywhere else this concept appears (integrationEventModel.
// summaryForSuperAdmin, and the three Client-facing integration pages'
// own eventStatusDetail()) — one definition, not reimplemented per screen.
function isRecovered(row) {
  return row.status === "received" && row.attempts > 0;
}

function serializeListRow(row) {
  return {
    id: row.id,
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    externalLeadId: row.external_lead_id,
    eventType: row.event_type,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    crmLeadId: row.crm_lead_id,
    recovered: isRecovered(row),
    summary: summarize(row),
    // Already sanitized before it ever reaches this table — see
    // ingestionService.handleProcessingFailure, which stores only
    // err.message (truncated to 500 chars), never a raw error object or
    // stack trace. Included alongside the friendlier `summary` above for
    // a power-user tooltip, not the primary thing rendered.
    lastError: row.last_error,
    // client_id can legitimately be NULL (an event that never resolved to
    // a Client at all — see the LEFT JOIN's own comment in the model) —
    // surfaced as null/"Unknown", never silently dropped from the list.
    clientId: row.client_id,
    clientName: row.client_name,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
  };
}

async function listEvents(query) {
  const filters = validateEventFilters(query);
  const { page, pageSize, offset } = parsePagination(query);

  const [rows, total, summary] = await Promise.all([
    integrationEventModel.listForSuperAdmin({ filters, limit: pageSize, offset }),
    integrationEventModel.countForSuperAdmin(filters),
    integrationEventModel.summaryForSuperAdmin(filters),
  ]);

  return {
    items: rows.map(serializeListRow),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    summary,
  };
}

async function getEventDetail(id) {
  const row = await integrationEventModel.findByIdForSuperAdmin(id);
  if (!row) throw httpError("Integration event not found.", 404);

  const rawPayload = typeof row.raw_payload === "string" ? JSON.parse(row.raw_payload) : row.raw_payload;

  return {
    ...serializeListRow(row),
    needsEnrichment: !!rawPayload?.needsEnrichment,
    attribution: rawPayload?.attribution ?? null,
    rawPayload: redactPayload(rawPayload),
  };
}

// Manual "Retry Now" (Super Admin only). Eligibility is decided ENTIRELY
// from the persisted event row — the browser supplies only the event id
// (see the controller/route), nothing here ever trusts a client-sent
// "retryable" flag or provider/client value. Mirrors the exact same
// states claimForManualRetry's own WHERE clause encodes, so this is a
// pre-check for a friendly REJECTED/IN_PROGRESS message, not the actual
// safety boundary — the atomic claim in ingestionService.retryEvent is.
function classifyRetryEligibility(row) {
  if (row.provider === "meta") {
    // No code path anywhere in this app ever writes provider='meta' into
    // integration_events (Meta uses its own separate metaLeadService/
    // metaCapiService pipeline and meta_lead_id column entirely) — a Meta
    // row can't actually reach this branch today. Kept as an explicit,
    // defense-in-depth exclusion anyway: this generic retry system must
    // never become a second way to replay a Meta event, even if that
    // ever changed.
    return { eligible: false, reason: "Meta events are not retried through this system." };
  }
  if (row.status === "processed" || row.status === "duplicate") {
    return { eligible: false, reason: "This event already completed successfully — there is nothing to retry." };
  }
  if (row.status === "processing") {
    return { eligible: false, inProgress: true, reason: "This event is currently being processed by another worker." };
  }
  if (row.status === "failed" && !row.next_attempt_at) {
    return { eligible: false, reason: "This event failed permanently and is not retryable." };
  }
  if (row.status === "failed" || row.status === "received") {
    return { eligible: true };
  }
  return { eligible: false, reason: `Event status "${row.status}" is not retryable.` };
}

function retryResultMessage(outcome) {
  if (outcome.outcome === "created") {
    if (!outcome.crmLeadId) return "Retried successfully — acknowledged without creating a lead (the provider indicated this shouldn't become a CRM lead).";
    if (outcome.isDuplicate) return `Retried successfully — resolved as a duplicate of an existing lead (#${outcome.crmLeadId}).`;
    return `Retried successfully — lead #${outcome.crmLeadId} created.`;
  }
  return outcome.retryable
    ? `Retry failed — it will be retried again automatically. ${outcome.error}`
    : `Retry failed permanently. ${outcome.error}`;
}

// Single write path for every manual-retry ATTEMPT this service makes,
// regardless of outcome — a rejected/in-progress attempt is still a Super
// Admin action worth being able to see later ("who tried to retry an
// already-processed event, and when"), not just the attempts that
// actually claimed and processed something.
async function auditRetryAttempt({ row, actorUserId, id, result, extra }) {
  await auditLogModel.create({
    tenantId: row.tenant_id ?? null,
    userId: actorUserId,
    action: "integration_event.manual_retry",
    entityType: "integration_event",
    entityId: Number(id),
    meta: { provider: row.provider, clientId: row.client_id, result, ...extra },
  });
}

async function retryEvent(id, actorUserId) {
  const row = await integrationEventModel.findByIdForSuperAdmin(id);
  if (!row) throw httpError("Integration event not found.", 404);

  const check = classifyRetryEligibility(row);
  if (!check.eligible) {
    const result = check.inProgress ? "IN_PROGRESS" : "REJECTED";
    logger.warn(
      `Integration monitoring: manual retry rejected for event ${id} (provider=${row.provider}, client_id=${row.client_id}) by user_id=${actorUserId}: ${check.reason}`
    );
    // Nothing claimed, so there is no new status — previousStatus/attempts
    // are still worth recording (Retry History needs to answer "what was
    // this event's state when the attempt was rejected", not just "why").
    await auditRetryAttempt({ row, actorUserId, id, result, extra: { reason: check.reason, message: check.reason, previousStatus: row.status, attempts: row.attempts } });
    return { result, message: check.reason, event: serializeListRow(row) };
  }

  const outcome = await ingestionService.retryEvent(id);

  // "skipped"/"not_found" here means the atomic claim itself lost a race
  // that happened AFTER the eligibility read above (a scheduler tick, the
  // stale-processing sweep, or another manual click won first) — the same
  // claim invariant every other caller of claimForProcessing/
  // claimForManualRetry relies on, just surfaced as a clear message
  // instead of silently doing nothing.
  if (outcome.outcome === "skipped" || outcome.outcome === "not_found") {
    const fresh = (await integrationEventModel.findByIdForSuperAdmin(id)) || row;
    const message = "This event was claimed by another process just now — its status has already moved on.";
    logger.warn(`Integration monitoring: manual retry for event ${id} could not claim it — already claimed or no longer eligible by the time of the attempt.`);
    await auditRetryAttempt({
      row, actorUserId, id, result: "IN_PROGRESS",
      extra: { reason: "lost claim race", message, previousStatus: row.status, newStatus: fresh.status, attempts: fresh.attempts },
    });
    return { result: "IN_PROGRESS", message, event: serializeListRow(fresh) };
  }

  const fresh = await integrationEventModel.findByIdForSuperAdmin(id);
  const result = outcome.outcome === "created" ? "SUCCESS" : "FAILED";
  const message = retryResultMessage(outcome);

  await auditRetryAttempt({
    row, actorUserId, id, result,
    // outcome.error is already sanitized before it ever reaches here — see
    // ingestionService.handleProcessingFailure, which stores only
    // err.message (truncated to 500 chars), never a raw error object or
    // stack trace. Same value integration_events.last_error already holds.
    extra: { crmLeadId: outcome.crmLeadId ?? null, message, previousStatus: row.status, newStatus: fresh.status, attempts: fresh.attempts, error: result === "FAILED" ? outcome.error : null },
  });
  logger.info(`Integration monitoring: manual retry for event ${id} finished with result=${result} (user_id=${actorUserId}).`);

  return { result, message, event: serializeListRow(fresh) };
}

// Retry History (Super Admin only) — reads the SAME audit_logs rows
// retryEvent above already writes, filtered to this one event. No second
// audit-log system: auditLogModel gains one new read function
// (listForEntity/countForEntity), reused by any future entity_type this
// table ever needs history for, not something new invented per-feature.
function serializeRetryHistoryRow(row) {
  const meta = (typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta) || {};
  return {
    id: row.id,
    createdAt: row.created_at,
    result: meta.result || null,
    initiatedBy: row.user_name || "Unknown user",
    initiatedByEmail: row.user_email || null,
    actorRole: row.user_role || null,
    previousStatus: meta.previousStatus ?? null,
    newStatus: meta.newStatus ?? null,
    attempts: meta.attempts ?? null,
    crmLeadId: meta.crmLeadId ?? null,
    error: meta.error ?? null,
    message: meta.message || meta.reason || null,
  };
}

async function getRetryHistory(id, query) {
  const event = await integrationEventModel.findByIdForSuperAdmin(id);
  if (!event) throw httpError("Integration event not found.", 404);

  const { page, pageSize, offset } = parsePagination(query);
  const [rows, total] = await Promise.all([
    auditLogModel.listForEntity({ entityType: "integration_event", entityId: id, limit: pageSize, offset }),
    auditLogModel.countForEntity({ entityType: "integration_event", entityId: id }),
  ]);

  return {
    items: rows.map(serializeRetryHistoryRow),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

module.exports = { listEvents, getEventDetail, retryEvent, getRetryHistory };
