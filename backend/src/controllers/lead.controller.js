const leadService = require("../services/leadService");
const leadActivityService = require("../services/leadActivityService");
const leadImportService = require("../services/leadImportService");
const asyncHandler = require("../utils/asyncHandler");
const { buildCsv } = require("../utils/csv");

function actorFrom(req) {
  return { userId: req.user.sub, role: req.user.role };
}

// yyyy-mm-dd — fully server-generated, never includes any user-controlled
// text, so there's nothing to sanitize in the filename itself.
function csvFilename(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
}

function sendCsv(res, filename, headers, rows) {
  // Leading UTF-8 BOM: without it, Excel (still the most common opener
  // for a downloaded .csv) misreads non-ASCII characters as the system's
  // default codepage instead of UTF-8 — a well-known, standard fix for
  // exactly this file type.
  const BOM = "﻿";
  const csv = BOM + buildCsv(headers, rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
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

const bulkAssign = asyncHandler(async (req, res) => {
  const result = await leadService.bulkAssignLeads(req.clientId, actorFrom(req), req.body);
  res.json(result);
});

const bulkChangeStatus = asyncHandler(async (req, res) => {
  const result = await leadService.bulkChangeStatus(req.clientId, actorFrom(req), req.body);
  res.json(result);
});

const exportFiltered = asyncHandler(async (req, res) => {
  const { headers, rows } = await leadService.exportFilteredLeads(req.clientId, actorFrom(req), req.query);
  sendCsv(res, csvFilename("leads-filtered"), headers, rows);
});

const exportSelected = asyncHandler(async (req, res) => {
  const { headers, rows } = await leadService.exportSelectedLeads(req.clientId, actorFrom(req), req.body);
  sendCsv(res, csvFilename("leads-selected"), headers, rows);
});

// req.file comes from multer's memoryStorage (middlewares/csvUpload.js) —
// req.body is never trusted for the file itself; the only body field read
// anywhere in this pair is `token`, on the confirm side.
const previewImport = asyncHandler(async (req, res) => {
  const result = await leadImportService.previewLeadImport(req.clientId, actorFrom(req), req.file);
  res.json(result);
});

const confirmImport = asyncHandler(async (req, res) => {
  const result = await leadImportService.confirmLeadImport(req.clientId, actorFrom(req), req.body?.token);
  res.json(result);
});

const listActivities = asyncHandler(async (req, res) => {
  const activities = await leadActivityService.listForLead(req.clientId, actorFrom(req), req.params.id);
  res.json({ activities });
});

const createActivity = asyncHandler(async (req, res) => {
  const activity = await leadActivityService.createForLead(req.clientId, actorFrom(req), req.params.id, req.body);
  res.status(201).json({ activity });
});

module.exports = {
  create,
  list,
  get,
  update,
  remove,
  changeStatus,
  assign,
  bulkAssign,
  bulkChangeStatus,
  exportFiltered,
  exportSelected,
  previewImport,
  confirmImport,
  listActivities,
  createActivity,
};
