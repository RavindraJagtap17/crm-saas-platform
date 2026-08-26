const express = require("express");
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/api/auth", authRoutes);

// Future route namespaces (added in later steps, per the approved spec §22):
// router.use("/api/leads", leadRoutes);
// router.use("/api/billing", billingRoutes);
// ...

module.exports = router;
