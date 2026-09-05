const express = require("express");
const { webhookLimiter } = require("../middlewares/webhookRateLimit");
const controller = require("../controllers/clientPaymentWebhook.controller");

const router = express.Router();

// Captures the exact raw bytes Razorpay sent, required for per-account
// signature verification — same pattern as the existing
// /api/razorpay/webhook and /api/razorpay/oauth-webhook, and equally
// excluded from the global body parser in app.js for the same reason.
router.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// PUBLIC — Razorpay's servers call this directly for every connected
// Agency account (one shared URL, differentiated by account_id + that
// account's own secret — see the controller's comment). Security comes
// entirely from per-account signature verification, not our own auth
// system.
router.post("/", webhookLimiter, controller.receiveEvent);

module.exports = router;
