const metaIntegrationModel = require("../models/metaIntegrationModel");
const metaFormFieldMappingModel = require("../models/metaFormFieldMappingModel");
const leadModel = require("../models/leadModel");
const leadSourceModel = require("../models/leadSourceModel");
const leadService = require("../services/leadService");
const metaIntegrationService = require("./metaIntegrationService");
const graphClient = require("../integrations/meta/graphClient");
const { CORE_FIELD_KEYS } = require("./metaFormFieldMappingService");
const { decrypt } = require("../utils/encryption");
const logger = require("../utils/logger");

/**
 * §D: the ONLY place a webhook event's tenant is ever determined. Never
 * trusts anything else in the payload — page_id, resolved against our
 * own meta_integration_settings, is the sole source of truth.
 */
async function resolveTenantByPageId(pageId) {
  return metaIntegrationModel.findByPageId(pageId);
}

/**
 * §F: walks Meta's field_data array, resolving each raw key through this
 * tenant+form's mappings. An unmapped field is dropped, not stored —
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
 * to a page_id. Returns a small result object describing what happened
 * — never throws for expected "nothing to do" outcomes (unknown page,
 * already processed, expired token, Graph API failure), since a webhook
 * handler responding 200 for those is correct: they are not reasons for
 * Meta to retry.
 */
async function processLeadgenEvent({ pageId, leadgenId, formId }) {
  const settings = await resolveTenantByPageId(pageId);
  if (!settings) {
    logger.warn(`Meta webhook: no tenant connected for page_id=${pageId}`);
    return { outcome: "unknown_page", tenantId: null };
  }
  const tenantId = settings.tenant_id;

  // §K idempotency pre-check — see leadModel.findByMetaLeadId's comment
  // for how the DB-level UNIQUE constraint backstops the race window.
  const existing = await leadModel.findByMetaLeadId(leadgenId);
  if (existing) {
    return { outcome: "already_processed", tenantId, leadId: existing.id };
  }

  if (metaIntegrationService.isTokenExpired(settings)) {
    logger.warn(`Meta webhook: token expired for tenant_id=${tenantId}, cannot fetch lead ${leadgenId}`);
    return { outcome: "token_expired", tenantId };
  }

  const accessToken = decrypt(settings.access_token_encrypted);

  let metaLead;
  try {
    metaLead = await graphClient.fetchLead(leadgenId, accessToken);
  } catch (err) {
    logger.error(`Meta webhook: Graph API fetch failed for lead ${leadgenId}: ${err.message}`);
    return { outcome: "graph_api_error", tenantId, error: err.message };
  }

  const resolvedFormId = formId || metaLead.form_id;
  const mappingsByRawKey = await metaFormFieldMappingModel.mapForForm(tenantId, resolvedFormId);
  const { coreFields, customFields, unmapped } = applyFieldMapping(metaLead.field_data, mappingsByRawKey);
  if (unmapped.length) {
    logger.warn(`Meta webhook: unmapped field(s) for tenant_id=${tenantId} form=${resolvedFormId}: ${unmapped.join(", ")}`);
  }

  const metaSource = await leadSourceModel.findOrCreateMetaSource(tenantId);
  const actor = { userId: null, role: "meta_integration" };

  try {
    const lead = await leadService.createLead(tenantId, actor, {
      name: coreFields.name,
      phone: coreFields.phone,
      email: coreFields.email,
      customFields,
      sourceId: metaSource.id,
      metaLeadId: leadgenId,
    });
    return { outcome: "created", tenantId, leadId: lead.id, isDuplicate: lead.isDuplicate };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      // Lost a race with another delivery of the same event between our
      // pre-check above and this insert — the constraint did its job.
      return { outcome: "already_processed", tenantId };
    }
    throw err;
  }
}

module.exports = { resolveTenantByPageId, applyFieldMapping, processLeadgenEvent };
