const leadModel = require("../models/leadModel");
const leadActivityModel = require("../models/leadActivityModel");
const httpError = require("../utils/httpError");
const { validateCreateActivity } = require("../validators/leadValidators");
const { scopeFor } = require("./leadService");

async function listForLead(tenantId, actor, leadId) {
  const lead = await leadModel.findById(tenantId, leadId, scopeFor(actor));
  if (!lead) throw httpError("Lead not found.", 404);
  return leadActivityModel.listForLead(tenantId, leadId);
}

// Only "call" and "note" are client-postable — "assignment" activities are
// only ever written by leadService.assignLead as a side effect, never
// directly by a client (§I / §J).
async function createForLead(tenantId, actor, leadId, body) {
  const lead = await leadModel.findById(tenantId, leadId, scopeFor(actor));
  if (!lead) throw httpError("Lead not found.", 404);

  const clean = validateCreateActivity(body);
  return leadActivityModel.create(null, tenantId, {
    leadId,
    userId: actor.userId,
    ...clean,
  });
}

module.exports = { listForLead, createForLead };
