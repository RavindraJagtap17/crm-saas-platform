const leadStatusService = require("../services/leadStatusService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  res.json({ statuses: await leadStatusService.list(req.clientId) });
});

const create = asyncHandler(async (req, res) => {
  const status = await leadStatusService.create(req.clientId, req.user.sub, req.body);
  res.status(201).json({ status });
});

const update = asyncHandler(async (req, res) => {
  const status = await leadStatusService.update(req.clientId, req.params.id, req.body);
  res.json({ status });
});

module.exports = { list, create, update };
