const rateLimit = require("express-rate-limit");

// Step 10 §J: Meta's and Razorpay's webhooks are public, unauthenticated-
// by-design endpoints (security comes from signature verification, not a
// session) — exactly the "other sensitive public endpoints" category.
// Signature verification is cheap, but an attacker without the secret can
// still spam invalid-signature requests, each costing an HMAC compute and
// a webhook_logs INSERT. This limit is deliberately generous — set high
// enough that it should never be reachable by genuine webhook delivery
// (even a large burst of real events) — it exists to blunt a targeted
// flood, not to throttle normal traffic.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many requests." });
  },
});

module.exports = { webhookLimiter };
