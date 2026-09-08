const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const { webhookLimiter } = require("../middlewares/webhookRateLimit");
const controller = require("../controllers/linkedinLeadForm.controller");

const router = express.Router();

// Captures the exact raw bytes LinkedIn sent, required for X-LI-Signature
// verification (see integrations/linkedin/verifySignature.js) — same
// reasoning and shape as meta.routes.js's own express.json() verify hook.
// Applied to this whole router; harmless for the non-webhook routes below
// (they never read req.rawBody).
router.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---- Webhook: PUBLIC, shared across every Client's connection (the
// :token in the path resolves which one, exactly like Google Ads' own
// /webhook/:token). GET is LinkedIn's challenge-response validation
// handshake; POST is the real lead notification. ----
router.get("/webhook/:token", controller.validateWebhook);
router.post("/webhook/:token", webhookLimiter, controller.receiveWebhook);

// ---- OAuth callback: PUBLIC (LinkedIn redirects the browser here) ----
// Secured by the signed `state` param instead of a session — see
// linkedinLeadFormService.verifyState.
router.get("/oauth/callback", controller.oauthCallback);

// ---- Everything else: Client Admin only, both client and agency must
// be active — the same gate every other provider's connection-management
// surface already uses. ----
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin"));

router.get("/connect", controller.connect);
router.get("/connection", controller.getConnection);
router.delete("/connection", controller.disconnect);

// Field mappings and recent events are NOT redefined here — they fall
// through to the generic /api/integrations/:provider/mappings and
// /api/integrations/:provider/events routes (integration.routes.js),
// which already work correctly for provider="linkedin" with zero
// LinkedIn-specific code. This router only ever adds what's genuinely
// provider-specific: the OAuth connect flow and the webhook itself.
module.exports = router;
