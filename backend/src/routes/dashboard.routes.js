const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/dashboard.controller");

const router = express.Router();

router.use(authenticate, tenantScope, requireRole("tenant_admin", "tenant_employee"));
router.get("/summary", controller.summary);

module.exports = router;
