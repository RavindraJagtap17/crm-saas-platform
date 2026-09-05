const config = require("../config");
const { verifyRazorpaySignature } = require("../integrations/razorpay/verifySignature");
const agencyRazorpayConnectService = require("../services/agencyRazorpayConnectService");
const webhookLogModel = require("../models/webhookLogModel");
const logger = require("../utils/logger");
const asyncHandler = require("../utils/asyncHandler");

// POST /api/razorpay/oauth-webhook — Partner/application-level events
// (Step 3 verification: currently only account.app.authorization_revoked
// is documented). A SEPARATE endpoint, secret, and file from the existing
// /api/razorpay/webhook (razorpayWebhook.routes.js / razorpayWebhookService.js,
// both left completely untouched by this step): Razorpay documents
// application-level Partner webhooks as configured independently per
// Partner app, each with its own secret — reusing RAZORPAY_WEBHOOK_SECRET
// (the platform account's own subscription/payment webhook secret) here
// would verify against the wrong key.
//
// No idempotency table is used here (unlike razorpay_webhook_events) —
// unnecessary: re-applying "mark this account_id disconnected" a second
// time for a retried delivery is a no-op with identical end state, not a
// duplicate side effect (no ledger row is ever created by this handler).
const receiveEvent = asyncHandler(async (req, res) => {
  const signatureHeader = req.headers["x-razorpay-signature"];
  const signatureValid =
    req.rawBody && config.razorpayPartner.webhookSecret
      ? verifyRazorpaySignature(req.rawBody, signatureHeader, config.razorpayPartner.webhookSecret)
      : false;

  if (!signatureValid) {
    await webhookLogModel.create({
      source: "razorpay_partner",
      eventType: req.body?.event || null,
      payload: req.body,
      signatureValid: false,
      processed: false,
      error: "Invalid or missing signature",
    });
    return res.status(403).json({ error: "Invalid signature." });
  }

  const eventType = req.body?.event;

  if (eventType === "account.app.authorization_revoked") {
    // Confirmed top-level (not payload-nested, unlike the subscription/
    // payment webhook body shape) — see Step 3 verification report.
    const accountId = req.body?.account_id;
    if (!accountId) {
      return res.status(200).json({ received: true, outcome: "malformed_event" });
    }
    const result = await agencyRazorpayConnectService.handleAuthorizationRevoked(accountId);
    logger.info(`Razorpay Partner webhook: authorization_revoked account_id=${accountId} -> ${result.outcome}`);
    return res.status(200).json({ received: true, outcome: result.outcome });
  }

  // Everything else Razorpay might add to this application-level webhook
  // in the future is acknowledged and otherwise ignored — no local state
  // this app reconciles from any other Partner event today.
  return res.status(200).json({ received: true, outcome: "ignored_event_type" });
});

module.exports = { receiveEvent };
