const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/customField.controller");

const router = express.Router();

// Post-Phase-D ownership fix: custom field DEFINITIONS are now managed by
// Agency Admin only (see client.routes.js's /:id/custom-fields — same
// client-scoped data, different manager). Client Admin/Employee keep
// READ access here — they still need field labels/types/options to
// render and display custom field values on leads — but creating,
// editing, or (de)activating a definition is no longer reachable through
// this router at all.
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin", "client_employee"));

router.get("/", controller.list);

module.exports = router;
