const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/client.controller");

const router = express.Router();

// Agency Admin only — client management is the agency-level counterpart
// of Client Admin's own dashboard, and is gated the same way (own agency
// must be active) as every other CRM-interior resource.
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("agency_admin"));

router.get("/", controller.list);
router.get("/limit", controller.limit);
router.get("/:id", validateIdParam(), controller.get);
router.post("/", controller.create);
router.patch("/:id/status", validateIdParam(), controller.setStatus);
router.post("/:id/invite-admin", validateIdParam(), controller.inviteAdmin);

// Custom field management — Agency Admin owns this for a selected client
// (post-Phase-D ownership fix; Client Admin keeps read-only access via
// /api/custom-fields, see customField.routes.js).
router.get("/:id/custom-fields", validateIdParam(), controller.listCustomFields);
router.post("/:id/custom-fields", validateIdParam(), controller.createCustomField);
router.patch("/:id/custom-fields/:fieldId", validateIdParam(), validateIdParam("fieldId"), controller.updateCustomField);

// Read-only — Website Form building needs a client's real source/product
// ids; creating/editing sources and products stays Client Admin's job.
router.get("/:id/lead-sources", validateIdParam(), controller.listLeadSources);
router.get("/:id/products", validateIdParam(), controller.listProducts);

module.exports = router;
