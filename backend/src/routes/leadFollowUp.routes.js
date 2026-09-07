const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/leadFollowUp.controller");

const router = express.Router();

// Same gate as lead.routes.js exactly — follow-ups are Client-interior
// data, not part of Super Admin's or Agency Admin's job (§10: Agency Admin
// must not access Client CRM follow-ups). requireActiveTenant blocks a
// suspended agency or a deactivated/unlicensed client the same way it
// already blocks the rest of the CRM interior.
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin", "client_employee"));

router.get("/", controller.list);
router.get("/:id", validateIdParam(), controller.get);
router.patch("/:id", validateIdParam(), controller.update);
router.post("/:id/complete", validateIdParam(), controller.complete);
router.post("/:id/cancel", validateIdParam(), controller.cancel);

module.exports = router;
