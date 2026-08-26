const config = require("../config");
const { verifyRazorpaySignature } = require("../integrations/razorpay/verifySignature");
const razorpayWebhookService = require("../services/razorpayWebhookService");
const webhookLogModel = require("../models/webhookLogModel");
const logger = require("../utils/logger");
const asyncHandler = require("../utils/asyncHandler");

// Razorpay's webhook body itself doesn't carry a single dedicated
// "delivery id" field, but `event` + `created_at` (the event's own
// creation time, not the delivery attempt's) + the affected entity's id
// together stay IDENTICAL across every retry of the SAME event — used
// only as a fallback for the rare case the x-razorpay-event-id header
// itself is missing (§F: "or an equivalent persisted unique event identity").
function resolveEventId(req, body) {
  const header = req.headers["x-razorpay-event-id"];
  if (header) return header;
  const entityId = body?.payload?.subscription?.entity?.id || body?.payload?.payment?.entity?.id || "";
  return `${body?.event || "unknown"}:${body?.created_at || ""}:${entityId}`;
}

// POST /api/razorpay/webhook — the real inbound event delivery. No GET
// handshake exists for Razorpay (unlike Meta's) — the webhook URL and
// secret are simply configured once in the Razorpay Dashboard.
const receiveEvent = asyncHandler(async (req, res) => {
  const signatureHeader = req.headers["x-razorpay-signature"];
  const signatureValid = req.rawBody ? verifyRazorpaySignature(req.rawBody, signatureHeader) : false;

  if (!signatureValid) {
    await webhookLogModel.create({
      source: "razorpay",
      eventType: req.body?.event || null,
      payload: req.body,
      signatureValid: false,
      processed: false,
      error: "Invalid or missing signature",
    });
    return res.status(403).json({ error: "Invalid signature." });
  }

  const eventType = req.body?.event;
  if (!eventType) {
    return res.status(400).json({ error: "Missing event type." });
  }

  const razorpayEventId = resolveEventId(req, req.body);

  const result = await razorpayWebhookService.processEvent({
    razorpayEventId,
    eventType,
    payload: req.body.payload,
  });

  if (result.outcome === "reconciled") {
    logger.info(`Razorpay webhook: ${eventType} reconciled for tenant_id=${result.tenantId} -> subscription=${result.subscriptionStatus} tenant=${result.tenantStatus}`);
  }

  // Always 200 once the signature is valid and processing didn't throw —
  // every outcome here (reconciled, already_processed, unknown_subscription,
  // malformed_event, ignored_event_type, payment_failure_recorded) is
  // "nothing more to do", not a reason for Razorpay to retry. A genuine
  // processing error instead propagates past asyncHandler to errorHandler,
  // which responds non-2xx — see razorpayWebhookService.processEvent's
  // comment for why that's the correct behavior here.
  res.status(200).json({ received: true, outcome: result.outcome });
});

module.exports = { receiveEvent };
