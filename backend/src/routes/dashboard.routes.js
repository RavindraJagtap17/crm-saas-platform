const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/dashboard.controller");

const router = express.Router();

router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin", "client_employee"));
router.get("/summary", controller.summary);

module.exports = router;
