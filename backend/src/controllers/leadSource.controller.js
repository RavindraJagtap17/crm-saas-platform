const leadSourceService = require("../services/leadSourceService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  res.json({ sources: await leadSourceService.list(req.clientId) });
});

const create = asyncHandler(async (req, res) => {
  const source = await leadSourceService.create(req.clientId, req.body);
  res.status(201).json({ source });
});

const update = asyncHandler(async (req, res) => {
  const source = await leadSourceService.update(req.clientId, req.params.id, req.body);
  res.json({ source });
});

module.exports = { list, create, update };
