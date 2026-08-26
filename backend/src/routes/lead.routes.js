const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/lead.controller");

const router = express.Router();

// Every route here requires a real session and a resolved tenant. Super
// Admin is deliberately excluded from all of them (§B/§L) — leads are not
// part of the platform-level role's job.
router.use(authenticate, tenantScope, requireRole("tenant_admin", "tenant_employee"));

router.post("/", controller.create);
router.get("/", controller.list);
router.get("/:id", validateIdParam(), controller.get);
router.patch("/:id", validateIdParam(), controller.update);
router.put("/:id", validateIdParam(), controller.update);
router.delete("/:id", validateIdParam(), requireRole("tenant_admin"), controller.remove);

// Action endpoints: each of these writes a companion audit row
// (lead_status_history / lead_activities) alongside the field update, so
// they're POST rather than folded into the generic PATCH above.
router.post("/:id/status", validateIdParam(), controller.changeStatus);
router.post("/:id/assign", validateIdParam(), requireRole("tenant_admin"), controller.assign);

router.get("/:id/activities", validateIdParam(), controller.listActivities);
router.post("/:id/activities", validateIdParam(), controller.createActivity);

module.exports = router;
