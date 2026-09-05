const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/agencyRazorpayConnect.controller");

const router = express.Router();

// PUBLIC — Razorpay redirects the browser here directly; no Authorization
// header is possible on a third-party redirect. Secured by the signed
// `state` param instead (see agencyRazorpayConnectService.verifyState).
router.get("/oauth/callback", controller.oauthCallback);

// Agency Admin only — connecting/viewing/disconnecting THEIR OWN agency's
// Razorpay account. requireActiveTenant is deliberately NOT applied here,
// same reasoning as billing.routes.js: an agency mid-signup, in its grace
// period, or otherwise not fully active must still be able to manage this.
router.use(authenticate, tenantScope, requireRole("agency_admin"));

router.get("/connect", controller.connect);
router.get("/connection", controller.getConnection);
router.delete("/connection", controller.disconnect);

module.exports = router;
