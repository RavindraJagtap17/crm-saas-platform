const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/lead.controller");

const router = express.Router();

// Every route here requires a real session and a resolved client. Super
// Admin and Agency Admin are deliberately excluded from all of them (§B/§L,
// extended for B2B2C: leads belong to a Client, not the agency, and are not
// part of either platform- or agency-level role's job). requireActiveTenant
// (Step 9 §I, now two-level) blocks a suspended/canceled agency OR a
// deactivated client from the CRM interior — leads are the core of that
// interior.
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin", "client_employee"));

router.post("/", controller.create);
router.get("/", controller.list);
router.get("/:id", validateIdParam(), controller.get);
router.patch("/:id", validateIdParam(), controller.update);
router.put("/:id", validateIdParam(), controller.update);
router.delete("/:id", validateIdParam(), requireRole("client_admin"), controller.remove);

// Action endpoints: each of these writes a companion audit row
// (lead_status_history / lead_activities) alongside the field update, so
// they're POST rather than folded into the generic PATCH above.
router.post("/:id/status", validateIdParam(), controller.changeStatus);
router.post("/:id/assign", validateIdParam(), requireRole("client_admin"), controller.assign);

router.get("/:id/activities", validateIdParam(), controller.listActivities);
router.post("/:id/activities", validateIdParam(), controller.createActivity);

module.exports = router;
