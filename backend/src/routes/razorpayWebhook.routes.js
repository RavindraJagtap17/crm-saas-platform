const express = require("express");
const controller = require("../controllers/razorpayWebhook.controller");

const router = express.Router();

// Captures the exact raw bytes Razorpay sent, required for signature
// verification (see integrations/razorpay/verifySignature.js) — HMAC must
// be computed over the original body, never a re-serialized JSON.parse()
// of it. Same pattern as Meta's webhook (Step 7); see app.js for the
// matching global-body-parser exclusion this depends on.
router.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// PUBLIC, shared across every tenant — Razorpay's servers call this
// directly and cannot present our session tokens. Security comes entirely
// from signature verification, not our own auth system.
router.post("/", controller.receiveEvent);

module.exports = router;
