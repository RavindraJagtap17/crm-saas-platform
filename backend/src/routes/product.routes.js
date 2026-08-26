const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/product.controller");

const router = express.Router();

router.use(authenticate, tenantScope, requireActiveTenant, requireRole("tenant_admin", "tenant_employee"));

router.get("/", controller.list);
router.post("/", requireRole("tenant_admin"), controller.create);
router.patch("/:id", validateIdParam(), requireRole("tenant_admin"), controller.update);

module.exports = router;
