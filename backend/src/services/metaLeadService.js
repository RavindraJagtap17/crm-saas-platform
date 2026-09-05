const metaIntegrationModel = require("../models/metaIntegrationModel");
const metaFormFieldMappingModel = require("../models/metaFormFieldMappingModel");
const clientModel = require("../models/clientModel");
const leadModel = require("../models/leadModel");
const leadSourceModel = require("../models/leadSourceModel");
const leadService = require("../services/leadService");
const metaIntegrationService = require("./metaIntegrationService");
const graphClient = require("../integrations/meta/graphClient");
const { CORE_FIELD_KEYS } = require("./metaFormFieldMappingService");
const { decrypt } = require("../utils/encryption");
const logger = require("../utils/logger");

/**
 * §D: the ONLY place a webhook event's scope is ever determined. Never
 * trusts anything else in the payload — page_id, resolved against our own
 * meta_integration_settings, is the sole source of truth. The full chain
 * is page_id -> meta_integration_settings.client_id -> clients.tenant_id
 * (the owning agency) — see processLeadgenEvent below.
 */
async function resolveClientByPageId(pageId) {
  return metaIntegrationModel.findByPageId(pageId);
}

/**
 * §F: walks Meta's field_data array, resolving each raw key through this
 * client+form's mappings. An unmapped field is dropped, not stored —
 * "do not store arbitrary unmapped fields silently" means exactly that:
 * silently DISCARD them (loudly would mean rejecting the whole lead over
 * one unmapped field, which isn't what the business wants either).
 */
function applyFieldMapping(fieldData, mappingsByRawKey) {
  const coreFields = {};
  const customFields = {};
  const unmapped = [];

  (fieldData || []).forEach((field) => {
    const rawKey = field.name;
    const value = Array.isArray(field.values) ? field.values[0] : field.values;
    const crmKey = mappingsByRawKey.get(rawKey);
    if (!crmKey) {
      unmapped.push(rawKey);
      return;
    }
    if (CORE_FIELD_KEYS.has(crmKey)) coreFields[crmKey] = value;
    else customFields[crmKey] = value;
  });

  return { coreFields, customFields, unmapped };
}

/**
 * §E–§H: the full pipeline for one Meta leadgen event, already resolved
 * to a page_id. Returns a small result object describing what happened —
 * never throws for expected "nothing to do" outcomes (unknown page,
 * already processed, expired token, Graph API failure), since a webhook
 * handler responding 200 for those is correct: they are not reasons for
 * Meta to retry. `tenantId` in the result is the resolved owning agency
 * (clients.tenant_id) — carried only for webhook_logs' existing tenant_id
 * column, never used to scope the lead itself (that's client_id).
 */
async function processLeadgenEvent({ pageId, leadgenId, formId }) {
  const settings = await resolveClientByPageId(pageId);
  if (!settings) {
    logger.warn(`Meta webhook: no client connected for page_id=${pageId}`);
    return { outcome: "unknown_page", clientId: null, tenantId: null };
  }
  const clientId = settings.client_id;
  const tenantId = await clientModel.findTenantIdForClient(clientId);

  // §K idempotency pre-check — see leadModel.findByMetaLeadId's comment
  // for how the DB-level UNIQUE constraint backstops the race window.
  const existing = await leadModel.findByMetaLeadId(leadgenId);
  if (existing) {
    return { outcome: "already_processed", clientId, tenantId, leadId: existing.id };
  }

  if (metaIntegrationService.isTokenExpired(settings)) {
    logger.warn(`Meta webhook: token expired for client_id=${clientId}, cannot fetch lead ${leadgenId}`);
    return { outcome: "token_expired", clientId, tenantId };
  }

  const accessToken = decrypt(settings.access_token_encrypted);

  let metaLead;
  try {
    metaLead = await graphClient.fetchLead(leadgenId, accessToken);
  } catch (err) {
    logger.error(`Meta webhook: Graph API fetch failed for lead ${leadgenId}: ${err.message}`);
    return { outcome: "graph_api_error", clientId, tenantId, error: err.message };
  }

  const resolvedFormId = formId || metaLead.form_id;
  const mappingsByRawKey = await metaFormFieldMappingModel.mapForForm(clientId, resolvedFormId);
  const { coreFields, customFields, unmapped } = applyFieldMapping(metaLead.field_data, mappingsByRawKey);
  if (unmapped.length) {
    logger.warn(`Meta webhook: unmapped field(s) for client_id=${clientId} form=${resolvedFormId}: ${unmapped.join(", ")}`);
  }

  const metaSource = await leadSourceModel.findOrCreateMetaSource(clientId);
  const actor = { userId: null, role: "meta_integration" };

  try {
    const lead = await leadService.createLead(clientId, actor, {
      name: coreFields.name,
      phone: coreFields.phone,
      email: coreFields.email,
      customFields,
      sourceId: metaSource.id,
      metaLeadId: leadgenId,
    });
    return { outcome: "created", clientId, tenantId, leadId: lead.id, isDuplicate: lead.isDuplicate };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      // Lost a race with another delivery of the same event between our
      // pre-check above and this insert — the constraint did its job.
      return { outcome: "already_processed", clientId, tenantId };
    }
    throw err;
  }
}

module.exports = { resolveClientByPageId, applyFieldMapping, processLeadgenEvent };
