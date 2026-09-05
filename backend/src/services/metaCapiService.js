const crypto = require("crypto");
const metaCapiEventModel = require("../models/metaCapiEventModel");
const metaIntegrationModel = require("../models/metaIntegrationModel");
const metaIntegrationService = require("./metaIntegrationService");
const leadModel = require("../models/leadModel");
const graphClient = require("../integrations/meta/graphClient");
const { normalizePhone } = require("../utils/phone");
const logger = require("../utils/logger");

// Meta's standard event representing "this lead qualified" — reported at
// the moment our own pipeline confirms it (the tenant's configured final
// status), not at Meta Lead Ads submission time (Step 7 already covers
// ingestion; this is a separate, later signal back to Meta). Not a
// custom/invented event name — one of Meta's own standard events.
const EVENT_NAME = "Lead";

// Bounded, increasing backoff — index is the *current* retry_count before
// this attempt. Exhausting the array (a 6th failure) is a permanent give-up,
// not an infinite loop.
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

function hashForMatching(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

// §D/§J: normalize-then-hash, exactly per Meta's Conversions API matching
// requirements — lowercased/trimmed email, digits-only phone (reusing the
// same normalizePhone() Step 4 already uses for duplicate detection,
// rather than a second phone-cleaning implementation). Returns null for
// missing input; the caller omits the field entirely rather than hashing
// an empty string, which Meta would treat as a real (wrong) match key.
function hashEmail(email) {
  if (!email) return null;
  const normalized = String(email).trim().toLowerCase();
  return normalized ? hashForMatching(normalized) : null;
}
function hashPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? hashForMatching(normalized) : null;
}

/**
 * §B: the ONLY entry point that decides whether a status change is a
 * conversion trigger. Called from leadService.changeStatus, inside its
 * existing transaction, so queuing is atomic with the status write itself
 * — either both land or neither does. Does nothing (returns null) for a
 * non-final status, and does nothing if this lead already has an event
 * (§H idempotency — see metaCapiEventModel.queueIfAbsent).
 */
async function maybeQueueConversion(conn, clientId, leadId, targetStatus) {
  if (!targetStatus?.is_final) return null;
  const metaEventId = `crm_lead_${clientId}_${leadId}`;
  return metaCapiEventModel.queueIfAbsent(conn, clientId, leadId, { eventName: EVENT_NAME, metaEventId });
}

// Schedules processing without making the caller (leadService) wait on a
// network call — §I: "the lead status change itself must not be lost
// simply because CAPI fails" / "CAPI failure should be isolated from the
// core CRM transaction." setImmediate defers this to the next event-loop
// tick, strictly after the HTTP response for the status-change request
// has already been built from the (already-committed) transaction result.
function scheduleProcessing(eventId, delayMs = 0) {
  const run = () =>
    processEvent(eventId).catch((err) => {
      logger.error(`Meta CAPI: unexpected error processing event ${eventId}: ${err.stack || err.message}`);
    });
  if (delayMs > 0) setTimeout(run, delayMs);
  else setImmediate(run);
}

function safeErrorMessage(result) {
  // Meta's own error message text — never the raw response body, never
  // anything we sent (so never a token, never a hash-adjacent value).
  const msg = String(result.message || "Meta API request failed.").slice(0, 500);
  return msg;
}

/**
 * §F/§G: claim → build payload → send → record outcome. Safe to call
 * more than once for the same eventId (claimForProcessing is the guard —
 * a row not currently pending/due-for-retry is left untouched), so both
 * the immediate post-status-change trigger and the startup/backoff sweep
 * can call this without coordinating with each other.
 */
async function processEvent(eventId) {
  const claimed = await metaCapiEventModel.claimForProcessing(eventId);
  if (!claimed) return; // already sent, already permanently failed, or not yet due

  const event = await metaCapiEventModel.findById(eventId);
  if (!event) return;

  const failPermanently = (lastError, metaResponseCode) =>
    metaCapiEventModel.markPermanentFailure(eventId, { retryCount: event.retry_count, lastError, metaResponseCode });

  // §E/§I.1/§I.2/§I.3: no connection, no pixel configured, or an expired
  // token are all things only a Client Admin action (reconnect Meta,
  // enter a Pixel ID) can fix — retrying automatically won't help, so
  // these fail permanently and safely rather than looping forever.
  const settings = await metaIntegrationModel.findByClient(event.client_id);
  if (!settings) {
    return failPermanently("Client has no Meta integration connected.", "NOT_CONNECTED");
  }
  if (!settings.pixel_id) {
    return failPermanently("No Meta Pixel/Dataset configured for this client.", "NO_PIXEL");
  }
  if (metaIntegrationService.isTokenExpired(settings)) {
    return failPermanently("Meta connection has expired or been revoked. Reconnect to resume sending conversions.", "TOKEN_EXPIRED");
  }

  const lead = await leadModel.findById(event.client_id, event.lead_id);
  if (!lead) {
    // Lead was deleted after the event was queued (the FK is CASCADE, so
    // in practice this row would already be gone too — defensive only).
    return failPermanently("Lead no longer exists.", "LEAD_GONE");
  }

  const userData = {};
  const emHash = hashEmail(lead.email);
  const phHash = hashPhone(lead.phone);
  if (emHash) userData.em = [emHash];
  if (phHash) userData.ph = [phHash];

  const payload = {
    event_name: event.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: event.meta_event_id,
    // No browser context (fbc/fbp/client_ip/user_agent) exists for a
    // backend pipeline status change — "system_generated" is Meta's own
    // action_source value for exactly this case, not an invented one.
    action_source: "system_generated",
    user_data: userData,
  };

  const { accessToken } = await metaIntegrationService.getDecryptedAccessToken(event.client_id);
  const result = await graphClient.sendCapiEvent(settings.pixel_id, accessToken, payload);

  if (result.ok) {
    await metaCapiEventModel.markSent(eventId, { metaResponseCode: `events_received:${result.eventsReceived ?? "?"}` });
    return;
  }

  if (!result.transient) {
    await metaCapiEventModel.markPermanentFailure(eventId, {
      retryCount: event.retry_count + 1,
      lastError: safeErrorMessage(result),
      metaResponseCode: result.code,
    });
    return;
  }

  await failTemporary(eventId, event.retry_count, { lastError: safeErrorMessage(result), metaResponseCode: result.code });
}

async function failTemporary(eventId, currentRetryCount, { lastError, metaResponseCode }) {
  const nextRetryCount = currentRetryCount + 1;
  if (nextRetryCount > MAX_ATTEMPTS) {
    await metaCapiEventModel.markPermanentFailure(eventId, {
      retryCount: nextRetryCount,
      lastError: `Max retry attempts (${MAX_ATTEMPTS}) exceeded. Last error: ${lastError}`,
      metaResponseCode,
    });
    return;
  }
  const backoffMs = BACKOFF_MINUTES[currentRetryCount] * 60 * 1000;
  const nextAttemptAt = new Date(Date.now() + backoffMs);
  await metaCapiEventModel.markTemporaryFailure(eventId, { retryCount: nextRetryCount, nextAttemptAt, lastError, metaResponseCode });
  scheduleProcessing(eventId, backoffMs);
}

/**
 * §F: recovers from a process restart — any event left `pending` (queued
 * but never got its post-commit setImmediate, e.g. the process died right
 * after) or `failed_temporary` with a due `next_attempt_at` (its setTimeout
 * was lost along with the old process) gets picked back up. Combined with
 * scheduleProcessing()'s setTimeout chaining for a still-running process,
 * this is the complete retry mechanism — no cron/external scheduler
 * needed for Phase 1's single-instance deployment.
 */
async function runStartupSweep() {
  try {
    const ids = await metaCapiEventModel.findDueForProcessing(200);
    ids.forEach((id) => scheduleProcessing(id));
    if (ids.length) logger.info(`Meta CAPI: startup sweep picked up ${ids.length} due event(s).`);
  } catch (err) {
    logger.error(`Meta CAPI: startup sweep failed: ${err.stack || err.message}`);
  }
}

module.exports = { maybeQueueConversion, scheduleProcessing, processEvent, runStartupSweep, EVENT_NAME };
