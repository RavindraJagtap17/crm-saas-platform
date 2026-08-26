const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const webhookController = require("../controllers/metaWebhook.controller");
const controller = require("../controllers/meta.controller");

const router = express.Router();

// Captures the exact raw bytes Meta sent, required for signature
// verification (see integrations/meta/verifySignature.js) — HMAC must be
// computed over the original body, not a re-serialized JSON.parse() of
// it. Applied to this whole router; harmless for the JSON-only routes
// below it (they just never read req.rawBody).
router.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---- Webhook: PUBLIC, shared across every tenant (§C) ----
// No authenticate/tenantScope here — Meta's servers call this directly
// and cannot present our session tokens. Security comes from signature
// verification (POST) and the verify_token handshake (GET), not from
// our own auth system.
router.get("/webhook", webhookController.verifySubscription);
router.post("/webhook", webhookController.receiveEvent);

// ---- OAuth callback: PUBLIC (Meta redirects the browser here) ----
// Secured by the signed `state` param instead of a session — see
// metaIntegrationService.verifyState.
router.get("/oauth/callback", controller.oauthCallback);

// ---- Everything else: Tenant Admin only ----
router.use(authenticate, tenantScope, requireRole("tenant_admin"));

router.get("/connect", controller.connect);
router.get("/connection", controller.getConnection);
router.patch("/connection", controller.updateConnection);
router.delete("/connection", controller.disconnect);
router.get("/forms", controller.listForms);

// Step 8 — Meta Conversions API admin visibility (§K).
router.get("/capi/events", controller.listCapiEvents);

router.get("/mappings", controller.listMappings);
router.post("/mappings", controller.createMapping);
router.patch("/mappings/:id", validateIdParam(), controller.updateMapping);
router.delete("/mappings/:id", validateIdParam(), controller.removeMapping);

module.exports = router;
