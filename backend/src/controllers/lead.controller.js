const leadService = require("../services/leadService");
const leadActivityService = require("../services/leadActivityService");
const asyncHandler = require("../utils/asyncHandler");

function actorFrom(req) {
  return { userId: req.user.sub, role: req.user.role };
}

const create = asyncHandler(async (req, res) => {
  const lead = await leadService.createLead(req.clientId, actorFrom(req), req.body);
  res.status(201).json({ lead });
});

const list = asyncHandler(async (req, res) => {
  const result = await leadService.listLeads(req.clientId, actorFrom(req), req.query);
  res.json(result);
});

const get = asyncHandler(async (req, res) => {
  const lead = await leadService.getLead(req.clientId, actorFrom(req), req.params.id);
  res.json({ lead });
});

const update = asyncHandler(async (req, res) => {
  const lead = await leadService.updateLead(req.clientId, actorFrom(req), req.params.id, req.body);
  res.json({ lead });
});

const remove = asyncHandler(async (req, res) => {
  await leadService.deleteLead(req.clientId, req.params.id);
  res.status(204).send();
});

const changeStatus = asyncHandler(async (req, res) => {
  const lead = await leadService.changeStatus(req.clientId, actorFrom(req), req.params.id, req.body);
  res.json({ lead });
});

const assign = asyncHandler(async (req, res) => {
  const lead = await leadService.assignLead(req.clientId, actorFrom(req), req.params.id, req.body);
  res.json({ lead });
});

const listActivities = asyncHandler(async (req, res) => {
  const activities = await leadActivityService.listForLead(req.clientId, actorFrom(req), req.params.id);
  res.json({ activities });
});

const createActivity = asyncHandler(async (req, res) => {
  const activity = await leadActivityService.createForLead(req.clientId, actorFrom(req), req.params.id, req.body);
  res.status(201).json({ activity });
});

module.exports = { create, list, get, update, remove, changeStatus, assign, listActivities, createActivity };
