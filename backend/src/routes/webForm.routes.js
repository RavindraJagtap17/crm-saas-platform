const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/webForm.controller");

const router = express.Router();

// Agency Admin only — Website Forms are managed at the agency level, each
// one targeting exactly one of the agency's own clients (Category C,
// dual-scoped: tenant_id for authorization, client_id for the CRM data it
// feeds into).
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("agency_admin"));

router.get("/", controller.list);
router.post("/", controller.create);
router.patch("/:id", validateIdParam(), controller.update);
router.get("/clients/:clientId/custom-fields", validateIdParam("clientId"), controller.listClientCustomFields);

module.exports = router;
