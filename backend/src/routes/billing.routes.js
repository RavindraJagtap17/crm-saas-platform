const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/billing.controller");

const router = express.Router();

// §C/§I: billing routes must stay reachable regardless of tenant status —
// this is precisely how a pending_payment tenant completes activation, and
// how any tenant recovers from suspended/canceled. requireActiveTenant is
// deliberately NOT applied anywhere in this file.
router.use(authenticate, tenantScope, requireRole("tenant_admin"));

router.get("/plans", controller.listPlans);
router.get("/subscription", controller.getSubscription);
router.get("/payments", controller.listPayments);
router.post("/subscribe", controller.subscribe);
router.patch("/subscription/plan", controller.changePlan);

module.exports = router;
