const integrationEventModel = require("../models/integrationEventModel");
const leadSourceModel = require("../models/leadSourceModel");
const leadSourceService = require("./leadSourceService");
const productService = require("./productService");
const integrationFieldMappingService = require("./integrationFieldMappingService");
const leadService = require("./leadService");
const httpError = require("../utils/httpError");
const logger = require("../utils/logger");

// Same bounded, increasing backoff metaCapiService.js already uses —
// reused verbatim rather than inventing a second schedule, so both
// queues behave identically from an ops/on-call point of view. Index is
// the *current* attempts count before this failure; exhausting the array
// is a permanent give-up, not an infinite retry loop.
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

// Every future provider adapter's own actor role when it calls
// leadService.createLead indirectly through ingest() below — the ONE
// role TRUSTED_INTEGRATION_ACTOR_ROLES added for exactly this purpose
// (see leadService.js). Not "meta_integration" — Meta keeps using its
// own dedicated role and its own dedicated pipeline, untouched.
const ACTOR_ROLE = "integration";

/**
 * Schedules processing without making the caller wait on it — identical
 * shape to metaCapiService.scheduleProcessing (setImmediate for "now",
 * setTimeout for a backoff delay).
 */
function scheduleProcessing(eventId, delayMs = 0) {
  const run = () =>
    processEvent(eventId).catch((err) => {
      logger.error(`Ingestion: unexpected error processing event ${eventId}: ${err.stack || err.message}`);
    });
  if (delayMs > 0) setTimeout(run, delayMs);
  else setImmediate(run);
}

// httpError's from validation/business-rule layers (bad custom field,
// unknown source, inactive assignee, ...) carry a 4xx status and will
// never succeed no matter how many times they're retried — permanent.
// Anything else (a transient DB/network failure, no .status at all) is
// assumed retryable, same "unless proven otherwise, retry" default
// metaCapiService's own `result.transient` flag encodes for CAPI sends.
function isRetryable(err) {
  return !(typeof err.status === "number" && err.status >= 400 && err.status < 500);
}

async function handleProcessingFailure(event, err) {
  const attempts = event.attempts + 1;
  const message = String(err.message || "Ingestion failed.").slice(0, 500);

  if (!isRetryable(err) || attempts > MAX_ATTEMPTS) {
    await integrationEventModel.markPermanentFailure(event.id, { attempts, lastError: message });
    logger.error(`Ingestion: permanent failure for event ${event.id} (provider=${event.provider}, client_id=${event.client_id}): ${message}`);
    return { outcome: "failed", eventId: event.id, retryable: false, error: message };
  }

  const backoffMs = BACKOFF_MINUTES[event.attempts] * 60 * 1000;
  const nextAttemptAt = new Date(Date.now() + backoffMs);
  await integrationEventModel.markRetryableFailure(event.id, { attempts, nextAttemptAt, lastError: message });
  logger.warn(`Ingestion: retryable failure for event ${event.id} (attempt ${attempts}/${MAX_ATTEMPTS}), next attempt at ${nextAttemptAt.toISOString()}: ${message}`);
  scheduleProcessing(event.id, backoffMs);
  return { outcome: "failed", eventId: event.id, retryable: true, error: message, nextAttemptAt };
}

/**
 * Resolves sourceId (§ field mapping / source resolution): an explicit
 * normalizedLead.sourceId always wins (an adapter that already knows
 * which lead_sources row to use); otherwise a per-Client, per-provider
 * source is found-or-created lazily, the same "Meta Ads" pattern
 * leadSourceModel.findOrCreateMetaSource already established, generalized
 * via findOrCreateForProvider.
 */
async function resolveSourceId(clientId, provider, sourceId, sourceDisplayName) {
  if (sourceId) {
    await leadSourceService.requireBelongsToClient(clientId, sourceId);
    return sourceId;
  }
  const source = await leadSourceModel.findOrCreateForProvider(clientId, provider, sourceDisplayName || provider);
  return source.id;
}

/**
 * Applies this Client+provider's field mappings to whatever raw external
 * fields the adapter supplied (§7/§8) — mirrors metaLeadService's own
 * "fetch mappings for this form, walk field_data" step exactly, one level
 * generic. Safe to call with no rawFields at all (an adapter that already
 * resolved contact/customFields itself, with nothing left to map).
 */
async function resolveFields(clientId, provider, externalFormId, rawFields) {
  if (!rawFields || !rawFields.length) return { coreFields: {}, customFields: {}, unmapped: [] };
  const mappingsByRawKey = await integrationFieldMappingService.mapForForm(clientId, provider, externalFormId || "default");
  const result = integrationFieldMappingService.applyMapping(rawFields, mappingsByRawKey);
  if (result.unmapped.length) {
    logger.warn(`Ingestion: unmapped field(s) for client_id=${clientId} provider=${provider} form=${externalFormId || "default"}: ${result.unmapped.join(", ")}`);
  }
  return result;
}

/**
 * The full pipeline for one already-claimed event. Reconstructs the
 * normalizedLead-shaped data it needs from the event row's own
 * raw_payload — this is what makes retry (from the in-process backoff
 * timer OR the startup sweep after a restart) possible without needing
 * to re-contact the provider: raw_payload persists the FULL normalized
 * lead this event was created from (contact/customFields/rawFields/
 * sourceId/productId/externalFormId), not just the provider's own
 * original payload.
 */
async function processClaimedEvent(event) {
  const normalizedLead = event.raw_payload || {};
  try {
    const { coreFields, customFields: mappedCustomFields, unmapped } = await resolveFields(
      event.client_id,
      event.provider,
      normalizedLead.externalFormId,
      normalizedLead.rawFields
    );

    if (normalizedLead.productId) {
      await productService.requireBelongsToClient(event.client_id, normalizedLead.productId);
    }
    const sourceId = await resolveSourceId(event.client_id, event.provider, normalizedLead.sourceId, normalizedLead.sourceDisplayName);

    const lead = await leadService.createLead(
      event.client_id,
      { userId: null, role: ACTOR_ROLE },
      {
        name: coreFields.name ?? normalizedLead.contact?.name,
        phone: coreFields.phone ?? normalizedLead.contact?.phone,
        email: coreFields.email ?? normalizedLead.contact?.email,
        sourceId,
        productId: normalizedLead.productId ?? undefined,
        customFields: { ...(normalizedLead.customFields || {}), ...mappedCustomFields },
      }
    );

    await integrationEventModel.markProcessed(event.id, { crmLeadId: lead.id });
    return { outcome: "created", eventId: event.id, crmLeadId: lead.id, isDuplicate: lead.isDuplicate, unmapped };
  } catch (err) {
    return handleProcessingFailure(event, err);
  }
}

/**
 * The main entry point every future provider adapter calls once it has a
 * NormalizedLead ready (§4/§5 of the design doc; §4 of this task).
 *
 * clientId MUST already be resolved and trusted — via
 * integrationConnectionService.resolveClientByExternalAccount(provider,
 * externalAccountId), a pure server-side DB lookup — before this function
 * is ever called. ingest() never re-derives clientId from anything else
 * in normalizedLead (rawPayload included) and never accepts it from an
 * inbound request body/query/header itself; there is no HTTP route in
 * this task that calls ingest() directly from an unauthenticated request
 * at all (that's the next task, per-provider).
 */
async function ingest(normalizedLead) {
  const { provider, clientId, externalLeadId, eventType, submittedAt } = normalizedLead;
  if (!provider || typeof provider !== "string") throw httpError("provider is required.", 400);
  if (!clientId || !Number.isInteger(Number(clientId))) throw httpError("clientId must already be resolved (see integrationConnectionService.resolveClientByExternalAccount).", 400);
  if (!externalLeadId || typeof externalLeadId !== "string") throw httpError("externalLeadId is required.", 400);

  // §6 idempotency — insert-if-absent against
  // uq_integration_events_provider_external_lead, exactly like
  // meta_capi_events.queueIfAbsent's own INSERT IGNORE precedent. The
  // full normalizedLead is what gets persisted as raw_payload (see
  // processClaimedEvent's own comment on why) — never anything from a
  // credential/connection row, only the lead-shaped data this call was
  // given.
  let event = await integrationEventModel.findByProviderAndExternalLeadId(provider, externalLeadId);
  if (!event) {
    event = await integrationEventModel.create({
      clientId,
      provider,
      externalLeadId,
      eventType: eventType || "lead",
      rawPayload: { ...normalizedLead, submittedAt: submittedAt ?? new Date().toISOString() },
    });
    if (!event) {
      // Lost a race with a concurrent delivery of the same event between
      // the read above and this insert — re-read what the winner wrote.
      event = await integrationEventModel.findByProviderAndExternalLeadId(provider, externalLeadId);
    }
  }

  if (event && ["processed", "duplicate"].includes(event.status)) {
    return { outcome: "duplicate", eventId: event.id, crmLeadId: event.crm_lead_id };
  }
  if (!event) {
    // Should be unreachable (the re-read above always finds a row once
    // INSERT IGNORE reports 0 affected rows), but never silently swallow
    // a truly unexpected state.
    throw httpError("Could not record integration event.", 500);
  }

  const claimed = await integrationEventModel.claimForProcessing(event.id);
  if (!claimed) {
    // Already claimed by a concurrent caller, or a permanently-failed row
    // nothing should retry — nothing more to do here.
    return { outcome: "skipped", eventId: event.id };
  }

  return processClaimedEvent(event);
}

/**
 * Re-claims and reprocesses one already-logged event — used by the
 * in-process backoff timer (scheduleProcessing above) and by the startup
 * sweep below. Safe to call more than once for the same eventId
 * (claimForProcessing is the guard), so both can call this without
 * coordinating with each other — identical shape to metaCapiService.
 * processEvent.
 */
async function processEvent(eventId) {
  const event = await integrationEventModel.findById(eventId);
  if (!event) return;
  const claimed = await integrationEventModel.claimForProcessing(eventId);
  if (!claimed) return; // already processed, already permanently failed, or not yet due
  return processClaimedEvent(event);
}

/**
 * Recovers from a process restart — any event left `received` (logged
 * but never got its post-commit setImmediate, e.g. the process died
 * right after) or `failed` with a due `next_attempt_at` (its setTimeout
 * was lost along with the old process) gets picked back up. Identical
 * role to metaCapiService.runStartupSweep — call this once at boot.
 */
async function runStartupSweep() {
  try {
    const ids = await integrationEventModel.findDueForProcessing(200);
    ids.forEach((id) => scheduleProcessing(id));
    if (ids.length) logger.info(`Ingestion: startup sweep picked up ${ids.length} due event(s).`);
  } catch (err) {
    logger.error(`Ingestion: startup sweep failed: ${err.stack || err.message}`);
  }
}

module.exports = { ingest, processEvent, scheduleProcessing, runStartupSweep, ACTOR_ROLE };
