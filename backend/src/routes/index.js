const express = require("express");
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");
const leadRoutes = require("./lead.routes");
const leadStatusRoutes = require("./leadStatus.routes");
const leadSourceRoutes = require("./leadSource.routes");
const productRoutes = require("./product.routes");
const customFieldRoutes = require("./customField.routes");
const tenantRoutes = require("./tenant.routes");
const userRoutes = require("./user.routes");
const dashboardRoutes = require("./dashboard.routes");
const superAdminRoutes = require("./superAdmin.routes");
const webFormRoutes = require("./webForm.routes");
const publicFormRoutes = require("./publicForm.routes");
const metaRoutes = require("./meta.routes");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/api/auth", authRoutes);
router.use("/api/leads", leadRoutes);
router.use("/api/lead-statuses", leadStatusRoutes);
router.use("/api/lead-sources", leadSourceRoutes);
router.use("/api/products", productRoutes);
router.use("/api/custom-fields", customFieldRoutes);
router.use("/api/tenant", tenantRoutes);
router.use("/api/users", userRoutes);
router.use("/api/dashboard", dashboardRoutes);
router.use("/api/super-admin", superAdminRoutes);
router.use("/api/web-forms", webFormRoutes);
router.use("/api/public/lead-form", publicFormRoutes);
router.use("/api/meta", metaRoutes);

// Future route namespaces (added in later steps, per the approved spec §22):
// router.use("/api/billing", billingRoutes);
// ...

module.exports = router;
