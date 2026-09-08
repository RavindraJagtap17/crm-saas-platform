const express = require("express");
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");
const leadRoutes = require("./lead.routes");
const leadFollowUpRoutes = require("./leadFollowUp.routes");
const leadStatusRoutes = require("./leadStatus.routes");
const leadSourceRoutes = require("./leadSource.routes");
const productRoutes = require("./product.routes");
const customFieldRoutes = require("./customField.routes");
const tenantRoutes = require("./tenant.routes");
const clientRoutes = require("./client.routes");
const userRoutes = require("./user.routes");
const dashboardRoutes = require("./dashboard.routes");
const superAdminRoutes = require("./superAdmin.routes");
const webFormRoutes = require("./webForm.routes");
const publicFormRoutes = require("./publicForm.routes");
const metaRoutes = require("./meta.routes");
const googleLeadFormRoutes = require("./googleLeadForm.routes");
const linkedinLeadFormRoutes = require("./linkedinLeadForm.routes");
const indiamartLeadFormRoutes = require("./indiamartLeadForm.routes");
const integrationRoutes = require("./integration.routes");
const razorpayWebhookRoutes = require("./razorpayWebhook.routes");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/api/auth", authRoutes);
router.use("/api/leads", leadRoutes);
router.use("/api/follow-ups", leadFollowUpRoutes);
router.use("/api/lead-statuses", leadStatusRoutes);
router.use("/api/lead-sources", leadSourceRoutes);
router.use("/api/products", productRoutes);
router.use("/api/custom-fields", customFieldRoutes);
router.use("/api/tenant", tenantRoutes);
router.use("/api/clients", clientRoutes);
router.use("/api/users", userRoutes);
router.use("/api/dashboard", dashboardRoutes);
router.use("/api/super-admin", superAdminRoutes);
router.use("/api/web-forms", webFormRoutes);
router.use("/api/public/lead-form", publicFormRoutes);
router.use("/api/meta", metaRoutes);
// Mounted BEFORE the generic /api/integrations router below — Express
// tries mounted routers in registration order, so /connect and
// /webhook/:token (defined only here) are handled by this router, while
// /connection, /mappings, and /events for provider="google" fall through
// unmatched to the generic router beneath it (see googleLeadForm.routes.js's
// own closing comment).
router.use("/api/integrations/google", googleLeadFormRoutes);
// Same fallthrough design as Google above — /connect, /oauth/callback,
// and /webhook/:token are handled here; /connection, /mappings, and
// /events for provider="linkedin" fall through unmatched to the generic
// router beneath it.
router.use("/api/integrations/linkedin", linkedinLeadFormRoutes);
// Same fallthrough design as Google/LinkedIn above — /connect and
// /webhook/:token are handled here; /connection, /mappings, and /events
// for provider="indiamart" fall through unmatched to the generic router
// beneath it.
router.use("/api/integrations/indiamart", indiamartLeadFormRoutes);
router.use("/api/integrations", integrationRoutes);
router.use("/api/razorpay/webhook", razorpayWebhookRoutes);

// Future route namespaces (added in later steps, per the approved spec §22):
// ...

module.exports = router;
