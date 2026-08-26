const config = require("../config");
const { verifyMetaSignature } = require("../integrations/meta/verifySignature");
const metaLeadService = require("../services/metaLeadService");
const webhookLogModel = require("../models/webhookLogModel");
const logger = require("../utils/logger");
const asyncHandler = require("../utils/asyncHandler");

// GET /api/meta/webhook — Meta's one-time subscription verification
// handshake, done once when the webhook URL is configured in the App
// Dashboard (not per-tenant — this whole endpoint is shared, §C).
function verifySubscription(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.meta.webhookVerifyToken) {
    return res.status(200).type("text/plain").send(challenge);
  }
  return res.status(403).json({ error: "Verification failed." });
}

// POST /api/meta/webhook — the real inbound event delivery.
const receiveEvent = asyncHandler(async (req, res) => {
  const signatureHeader = req.headers["x-hub-signature-256"];
  const signatureValid = req.rawBody ? verifyMetaSignature(req.rawBody, signatureHeader) : false;

  if (!signatureValid) {
    await webhookLogModel.create({
      source: "meta",
      eventType: "leadgen",
      payload: req.body,
      signatureValid: false,
      processed: false,
      error: "Invalid or missing signature",
    });
    // 403, not 401 — this isn't "log in and retry", it's "this request
    // was never legitimately from Meta".
    return res.status(403).json({ error: "Invalid signature." });
  }

  const entries = req.body?.entry || [];
  const results = [];

  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== "leadgen") continue;
      const value = change.value || {};
      const pageId = value.page_id || entry.id;
      const leadgenId = value.leadgen_id;
      const formId = value.form_id;

      if (!pageId || !leadgenId) {
        results.push({ outcome: "malformed_event" });
        continue;
      }

      try {
        const result = await metaLeadService.processLeadgenEvent({ pageId, leadgenId, formId });
        results.push(result);
        await webhookLogModel.create({
          source: "meta",
          tenantId: result.tenantId,
          eventType: "leadgen",
          payload: { pageId, leadgenId, formId },
          signatureValid: true,
          processed: result.outcome === "created" || result.outcome === "already_processed",
          error: ["unknown_page", "token_expired", "graph_api_error"].includes(result.outcome) ? result.outcome : null,
        });
      } catch (err) {
        logger.error(`Meta webhook: unexpected error processing lead ${leadgenId}: ${err.stack || err.message}`);
        await webhookLogModel.create({
          source: "meta",
          eventType: "leadgen",
          payload: { pageId, leadgenId, formId },
          signatureValid: true,
          processed: false,
          error: err.message,
        });
        results.push({ outcome: "error" });
      }
    }
  }

  // Always 200 once the signature is valid — Meta retries on non-2xx,
  // and every "nothing to do" outcome above (unknown page, already
  // processed, expired token, a single bad entry in a batch) is
  // deliberately not something we want retried.
  res.status(200).json({ received: true, results });
});

module.exports = { verifySubscription, receiveEvent };
