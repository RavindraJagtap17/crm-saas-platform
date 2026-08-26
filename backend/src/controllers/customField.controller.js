const customFieldService = require("../services/customFieldService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  res.json({ customFields: await customFieldService.list(req.tenantId) });
});

const create = asyncHandler(async (req, res) => {
  const customField = await customFieldService.create(req.tenantId, req.body);
  res.status(201).json({ customField });
});

const update = asyncHandler(async (req, res) => {
  const customField = await customFieldService.update(req.tenantId, req.params.id, req.body);
  res.json({ customField });
});

module.exports = { list, create, update };
