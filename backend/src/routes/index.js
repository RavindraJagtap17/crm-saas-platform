const express = require("express");
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");
const leadRoutes = require("./lead.routes");
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
const billingRoutes = require("./billing.routes");
const razorpayWebhookRoutes = require("./razorpayWebhook.routes");
const razorpayPartnerWebhookRoutes = require("./razorpayPartnerWebhook.routes");
const clientPaymentWebhookRoutes = require("./clientPaymentWebhook.routes");
const agencyRazorpayConnectRoutes = require("./agencyRazorpayConnect.routes");
const clientSubscriptionPlanRoutes = require("./clientSubscriptionPlan.routes");
const clientBillingRoutes = require("./clientBilling.routes");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/api/auth", authRoutes);
router.use("/api/leads", leadRoutes);
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
router.use("/api/billing", billingRoutes);
router.use("/api/razorpay/webhook", razorpayWebhookRoutes);
router.use("/api/razorpay/oauth-webhook", razorpayPartnerWebhookRoutes);
router.use("/api/razorpay/client-webhook", clientPaymentWebhookRoutes);
router.use("/api/agency-razorpay", agencyRazorpayConnectRoutes);
router.use("/api/client-plans", clientSubscriptionPlanRoutes);
router.use("/api/client-billing", clientBillingRoutes);

// Future route namespaces (added in later steps, per the approved spec §22):
// ...

module.exports = router;
