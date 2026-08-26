const webFormService = require("../services/webFormService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  res.json({ forms: await webFormService.list(req.tenantId) });
});

const create = asyncHandler(async (req, res) => {
  const form = await webFormService.create(req.tenantId, req.body);
  res.status(201).json({ form });
});

const update = asyncHandler(async (req, res) => {
  const form = await webFormService.update(req.tenantId, req.params.id, req.body);
  res.json({ form });
});

module.exports = { list, create, update };
