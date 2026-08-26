const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/tenant.controller");

const router = express.Router();

router.use(authenticate, tenantScope, requireRole("tenant_admin", "tenant_employee"));

// GET is deliberately NOT gated by requireActiveTenant (Step 9 §I): a
// pending_payment/suspended tenant still needs to read its own tenant.status
// (the frontend's billing page relies on this — see admin-billing.js) —
// branding edits, however, are CRM-interior configuration like anything else.
router.get("/", controller.getOwn);
router.patch("/", requireActiveTenant, requireRole("tenant_admin"), controller.updateOwn);

module.exports = router;
