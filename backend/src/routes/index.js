const express = require("express");
const healthRoutes = require("./health.routes");

const router = express.Router();

router.use("/health", healthRoutes);

// Future route namespaces (added in later steps, per the approved spec §22):
// router.use("/auth", authRoutes);
// router.use("/leads", leadRoutes);
// router.use("/billing", billingRoutes);
// ...

module.exports = router;
