const leadFollowUpService = require("../services/leadFollowUpService");
const asyncHandler = require("../utils/asyncHandler");

function actorFrom(req) {
  return { userId: req.user.sub, role: req.user.role };
}

const createForLead = asyncHandler(async (req, res) => {
  const followUp = await leadFollowUpService.createForLead(req.clientId, actorFrom(req), req.params.id, req.body);
  res.status(201).json({ followUp });
});

const list = asyncHandler(async (req, res) => {
  const result = await leadFollowUpService.listFollowUps(req.clientId, actorFrom(req), req.query);
  res.json(result);
});

const get = asyncHandler(async (req, res) => {
  const followUp = await leadFollowUpService.getFollowUp(req.clientId, actorFrom(req), req.params.id);
  res.json({ followUp });
});

const update = asyncHandler(async (req, res) => {
  const followUp = await leadFollowUpService.updateFollowUp(req.clientId, actorFrom(req), req.params.id, req.body);
  res.json({ followUp });
});

const complete = asyncHandler(async (req, res) => {
  const followUp = await leadFollowUpService.completeFollowUp(req.clientId, actorFrom(req), req.params.id);
  res.json({ followUp });
});

const cancel = asyncHandler(async (req, res) => {
  const followUp = await leadFollowUpService.cancelFollowUp(req.clientId, actorFrom(req), req.params.id);
  res.json({ followUp });
});

module.exports = { createForLead, list, get, update, complete, cancel };
