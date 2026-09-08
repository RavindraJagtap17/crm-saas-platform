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
 * Integration event recovery & operational hardening — a small, generic
 * extension point for providers whose webhook notification alone doesn't
 * carry a usable lead (LinkedIn today; Meta deliberately does NOT use
 * this, see metaLeadService.js's own pipeline, kept separate and
 * untouched). A provider registers ONE function here; ingestionService
 * itself never knows or cares which provider needs it or why — the
 * decision to persist a notification-only placeholder and mark it
 * needsEnrichment is entirely the provider adapter's own (see
 * linkedinLeadFormService.js). This is what lets the exact same
 * claim/retry/stale-recovery machinery every provider already shares
 * also recover a LinkedIn event whose enrichment fetch never completed —
 * no separate queue, no LinkedIn-specific branch anywhere below.
 */
const enrichmentHooks = new Map();
function registerEnrichment(provider, fn) {
  enrichmentHooks.set(provider, fn);
}

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
  let normalizedLead = event.raw_payload || {};
  try {
    if (normalizedLead.needsEnrichment) {
      const enrich = enrichmentHooks.get(event.provider);
      if (!enrich) {
        // Defensive only — every provider that ever sets needsEnrichment
        // registers its own hook at module load (see
        // linkedinLeadFormService.js); this should be unreachable, but
        // failing loudly here beats silently processing an incomplete
        // payload as if it had already been enriched.
        throw new Error(`No enrichment hook registered for provider "${event.provider}".`);
      }
      const enriched = await enrich(event);
      if (!enriched) {
        // The provider determined, only once its own fetch completed,
        // that this notification should be acknowledged without ever
        // becoming a CRM lead (e.g. a test lead) — the same "processed,
        // nothing more to do" terminal outcome a duplicate delivery
        // already represents, just discovered a step later.
        await integrationEventModel.markProcessed(event.id, { crmLeadId: null });
        return { outcome: "created", eventId: event.id, crmLeadId: null, isDuplicate: false, unmapped: [] };
      }
      normalizedLead = enriched;
      // Persist the now-complete payload so a LATER retry (if something
      // below still fails, e.g. a mapping/validation error) doesn't need
      // to re-enrich — the same "already fetched, just replay it" benefit
      // every other provider's raw_payload already gives retries for free.
      await integrationEventModel.updateRawPayload(event.id, normalizedLead);
    }

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

    // Deliberately its own try/catch, separate from everything above: the
    // lead already exists at this point (committed by createLead's own
    // transaction). A failure writing that fact back to this event row
    // must NEVER fall into the catch below — handleProcessingFailure
    // schedules a from-scratch retry, and nothing re-checks "did this
    // event already produce a lead" before reprocessing (see ingest()'s
    // own comment on why clientId/idempotency are only ever checked once,
    // at intake) — a retry here would call createLead a SECOND time for
    // the same external lead, producing a silent duplicate. markProcessed
    // is a single idempotent-by-primary-key UPDATE with no external
    // dependency, so a few immediate retries handle the realistic
    // transient case (a momentary pool/connection blip); only if all of
    // them fail is this logged for manual reconciliation and the row left
    // in 'processing' — recoverStaleProcessing's own comment covers the
    // (much rarer, and disclosed) residual risk that reintroduces.
    let markedProcessed = false;
    let markErr;
    for (let attempt = 1; attempt <= 3 && !markedProcessed; attempt++) {
      try {
        await integrationEventModel.markProcessed(event.id, { crmLeadId: lead.id });
        markedProcessed = true;
      } catch (err) {
        markErr = err;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
    if (!markedProcessed) {
      logger.error(
        `Ingestion: lead ${lead.id} was created for event ${event.id} (provider=${event.provider}, client_id=${event.client_id}) but markProcessed failed after 3 attempts — left as 'processing' for manual reconciliation rather than retried, to avoid creating a duplicate lead: ${markErr.message}`
      );
    }
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
  // Integration event recovery & operational hardening: returns an
  // explicit { outcome: "skipped" } rather than bare undefined for every
  // "nothing to do" case — existing callers (scheduleProcessing's own
  // fire-and-forget wrapper) never inspected the return value, so this is
  // safe, but a NEW caller now does: linkedinLeadFormService.
  // handleWebhookEvent calls this directly (instead of ingest()) so the
  // exact same claim/enrich/process path handles both the synchronous
  // first attempt and every later retry — it needs a real HTTP status to
  // give LinkedIn back, which means it needs a real outcome, not undefined.
  if (!event) return { outcome: "skipped", eventId };
  const claimed = await integrationEventModel.claimForProcessing(eventId);
  if (!claimed) return { outcome: "skipped", eventId }; // already processed, already permanently failed, claimed by someone else, or not yet due
  return processClaimedEvent(event);
}

/**
 * Super Admin manual "Retry Now" — identical shape to processEvent above,
 * the ONE difference being which model function performs the claim
 * (claimForManualRetry, not claimForProcessing — see that function's own
 * comment for why). Everything after the claim is the exact same
 * processClaimedEvent every other path already uses: the enrichment hook
 * runs again for a provider that needs it (LinkedIn), Google/IndiaMART's
 * already-complete raw_payload is replayed directly, and a
 * successfully-created lead is recorded through the same markProcessed
 * call — there is no second retry/lead-creation path here. The caller
 * (integrationMonitoringService) is responsible for the eligibility
 * pre-check that turns a lost claim race into a friendly message instead
 * of a bare "skipped".
 */
async function retryEvent(eventId) {
  const event = await integrationEventModel.findById(eventId);
  if (!event) return { outcome: "not_found", eventId };
  const claimed = await integrationEventModel.claimForManualRetry(eventId);
  if (!claimed) return { outcome: "skipped", eventId };
  return processClaimedEvent(event);
}

// Production reliability audit finding: claimForProcessing's own WHERE
// clause can only ever move a row OUT of 'processing' (into 'processed'/
// 'duplicate'/'failed') — nothing already in this codebase can reclaim a
// row that's stuck IN 'processing', including this same startup sweep,
// because a crash mid-processClaimedEvent (or, before this audit, a
// markProcessed failure — see processClaimedEvent's own comment) leaves
// no 'received'/due-'failed' row for findDueForProcessing to find at all.
// 15 minutes is comfortably above how long a real processClaimedEvent run
// ever takes (a handful of indexed queries, no long-running work) — never
// mistakes a genuinely in-flight row for an abandoned one under normal
// operation.
const STALE_PROCESSING_MINUTES = 15;

/**
 * Recovers from a process restart — any event left `received` (logged
 * but never got its post-commit setImmediate, e.g. the process died
 * right after), `failed` with a due `next_attempt_at` (its setTimeout was
 * lost along with the old process), or stuck `processing` (see
 * STALE_PROCESSING_MINUTES's own comment) gets picked back up. Identical
 * role to metaCapiService.runStartupSweep — call this once at boot, and
 * safe to call repeatedly (idempotent) if also registered as a recurring
 * job (see jobs/index.js) — the recurring case is what actually covers a
 * stale-processing row detected hours into a long-running process, not
 * just at its next restart.
 */
async function runStartupSweep() {
  try {
    const recovered = await integrationEventModel.recoverStaleProcessing(STALE_PROCESSING_MINUTES);
    if (recovered) logger.warn(`Ingestion: recovered ${recovered} event(s) stuck in "processing" for over ${STALE_PROCESSING_MINUTES} minutes.`);
    const ids = await integrationEventModel.findDueForProcessing(200);
    ids.forEach((id) => scheduleProcessing(id));
    if (ids.length) logger.info(`Ingestion: startup sweep picked up ${ids.length} due event(s).`);
  } catch (err) {
    logger.error(`Ingestion: startup sweep failed: ${err.stack || err.message}`);
  }
}

module.exports = { ingest, processEvent, retryEvent, scheduleProcessing, runStartupSweep, registerEnrichment, ACTOR_ROLE };
