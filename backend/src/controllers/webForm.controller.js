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

// GET /api/web-forms/clients/:clientId/custom-fields — read-only, lets the
// Agency Admin see a client's active custom fields while building a form.
const listClientCustomFields = asyncHandler(async (req, res) => {
  const customFields = await webFormService.listClientCustomFieldsForForm(req.tenantId, req.params.clientId);
  res.json({ customFields });
});

module.exports = { list, create, update, listClientCustomFields };
