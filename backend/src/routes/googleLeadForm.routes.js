const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const { webhookLimiter } = require("../middlewares/webhookRateLimit");
const controller = require("../controllers/googleLeadForm.controller");

const router = express.Router();

// ---- Webhook: PUBLIC, shared across every Client's connection (the
// :token in the path is what resolves which one — see
// googleLeadFormService.handleWebhookEvent). No signature header exists
// for this provider (confirmed against Google's own implementation
// docs) — verification is the google_key field inside the JSON body,
// checked in the service layer, not a raw-body HMAC — so, unlike
// /api/meta/webhook, this route needs no special raw-body capture and is
// fine using the app-wide express.json() parser in app.js as-is. ----
router.post("/webhook/:token", webhookLimiter, controller.receiveWebhook);

// ---- Everything else: Client Admin only, both client and agency must
// be active — the same gate every other provider's connection-management
// surface already uses. ----
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin"));

router.post("/connect", controller.connect);
router.get("/connection", controller.getConnection);
router.delete("/connection", controller.disconnect);

// Field mappings and recent events are NOT redefined here — they fall
// through to the generic /api/integrations/:provider/mappings and
// /api/integrations/:provider/events routes (integration.routes.js),
// which already work correctly for provider="google" with zero
// Google-specific code. This router only ever adds what's genuinely
// provider-specific: the connect flow and the webhook itself.
module.exports = router;
