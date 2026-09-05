const express = require("express");
const { webhookLimiter } = require("../middlewares/webhookRateLimit");
const controller = require("../controllers/razorpayPartnerWebhook.controller");

const router = express.Router();

// Captures the exact raw bytes Razorpay sent, required for signature
// verification — same pattern as the existing /api/razorpay/webhook and
// /api/meta/webhook, and equally excluded from the global body parser in
// app.js for the same reason (see that file's comment).
router.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// PUBLIC — Razorpay's servers call this directly. Security comes entirely
// from signature verification (against RAZORPAY_PARTNER_WEBHOOK_SECRET,
// not RAZORPAY_WEBHOOK_SECRET), not our own auth system.
router.post("/", webhookLimiter, controller.receiveEvent);

module.exports = router;
