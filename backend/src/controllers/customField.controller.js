const customFieldService = require("../services/customFieldService");
const asyncHandler = require("../utils/asyncHandler");

// Read-only from here on — see customField.routes.js. Management (create/
// update) moved to client.controller.js's Agency-Admin-scoped endpoints.
const list = asyncHandler(async (req, res) => {
  res.json({ customFields: await customFieldService.list(req.clientId) });
});

module.exports = { list };
