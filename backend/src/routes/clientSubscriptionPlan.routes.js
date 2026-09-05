const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/clientSubscriptionPlan.controller");

const router = express.Router();

// Agency Admin only — managing their own agency's Client plan catalog
// (migration 043). Gated exactly like client.routes.js (client management,
// the closest existing analog): ordinary CRM-interior management, not a
// route that itself needs to stay reachable while the agency is inactive
// (unlike billing.routes.js's deliberate carve-out for billing recovery).
// No Client Admin / Client Employee / Super Admin access — this table has
// no read-only consumer wired up yet (§10's "Clients see active plans" is
// future Client-subscription work, not part of this step).
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("agency_admin"));

router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", validateIdParam(), controller.get);
router.put("/:id", validateIdParam(), controller.update);
router.post("/:id/deactivate", validateIdParam(), controller.deactivate);

module.exports = router;
