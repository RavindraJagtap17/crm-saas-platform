const express = require("express");
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");
const leadRoutes = require("./lead.routes");
const leadStatusRoutes = require("./leadStatus.routes");
const leadSourceRoutes = require("./leadSource.routes");
const productRoutes = require("./product.routes");
const customFieldRoutes = require("./customField.routes");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/api/auth", authRoutes);
router.use("/api/leads", leadRoutes);
router.use("/api/lead-statuses", leadStatusRoutes);
router.use("/api/lead-sources", leadSourceRoutes);
router.use("/api/products", productRoutes);
router.use("/api/custom-fields", customFieldRoutes);

// Future route namespaces (added in later steps, per the approved spec §22):
// router.use("/api/dashboard", dashboardRoutes);
// router.use("/api/billing", billingRoutes);
// ...

module.exports = router;
