const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/clientBilling.controller");

const router = express.Router();

// Client Billing/Subscription — deliberately NOT gated by
// requireActiveTenant (same reasoning as billing.routes.js and
// agencyRazorpayConnect.routes.js): this is precisely how a locked-out
// Client recovers (Part J's explicit exception), so it must stay
// reachable regardless of client/agency/subscription status.
//
// client_admin only: Client Employee has no billing/subscription
// capability at all (finalized business model) — the frontend has no
// billing UI for that role either (see shell.js's client_employee nav).
router.use(authenticate, tenantScope, requireRole("client_admin"));

router.get("/plans", controller.listPlans);
router.get("/subscription", controller.getSubscription);
router.post("/subscription", controller.chooseSubscription);
router.post("/subscription/retry", controller.retryPayment);
router.post("/subscription/pay-renewal", controller.payRenewal);
router.post("/subscription/downgrade", controller.requestDowngrade);
router.post("/subscription/upgrade", controller.requestUpgrade);
router.post("/subscription/cancel", controller.cancelSubscription);

module.exports = router;
