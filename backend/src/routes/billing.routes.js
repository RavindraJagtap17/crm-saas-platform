const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/billing.controller");

const router = express.Router();

// PUBLIC — no auth, registered before the auth gate below on purpose
// (Express applies router.use middleware only to routes registered after
// it on the same router). Lets an anonymous visitor on the self-service
// signup page see the Agency plan's price before an account exists.
router.get("/agency-plan", controller.getAgencyPlanPublic);

// §C/§I: billing routes must stay reachable regardless of tenant status —
// this is precisely how a pending_payment tenant completes activation, and
// how any tenant recovers from suspended/canceled. requireActiveTenant is
// deliberately NOT applied anywhere in this file.
router.use(authenticate, tenantScope, requireRole("agency_admin"));

router.get("/plans", controller.listPlans);
router.get("/subscription", controller.getSubscription);
router.get("/payments", controller.listPayments);
router.post("/subscribe", controller.subscribe);
router.patch("/subscription/plan", controller.changePlan);

// New business model — single-plan self-service Agency subscription
// (agency_subscription_plan/agency_subscriptions, migrations 041/042).
// Distinct routes from the ones above rather than replacing them: the
// existing /subscribe, /subscription, /subscription/plan routes still
// serve any tenant already on the old multi-plan catalog, untouched.
router.post("/agency-subscription", controller.initiateAgencySubscription);
router.get("/agency-subscription", controller.getAgencySubscription);
router.post("/agency-subscription/cancel", controller.cancelAgencySubscription);

module.exports = router;
