const leadModel = require("../models/leadModel");
const leadActivityModel = require("../models/leadActivityModel");
const httpError = require("../utils/httpError");
const { validateCreateActivity } = require("../validators/leadValidators");
const { scopeFor } = require("./leadService");

async function listForLead(clientId, actor, leadId) {
  const lead = await leadModel.findById(clientId, leadId, scopeFor(actor));
  if (!lead) throw httpError("Lead not found.", 404);
  return leadActivityModel.listForLead(clientId, leadId);
}

// Only "call" and "note" are client-postable — "assignment" activities are
// only ever written by leadService.assignLead as a side effect, never
// directly by a client (§I / §J).
async function createForLead(clientId, actor, leadId, body) {
  const lead = await leadModel.findById(clientId, leadId, scopeFor(actor));
  if (!lead) throw httpError("Lead not found.", 404);

  const clean = validateCreateActivity(body);
  return leadActivityModel.create(null, clientId, {
    leadId,
    userId: actor.userId,
    ...clean,
  });
}

module.exports = { listForLead, createForLead };
