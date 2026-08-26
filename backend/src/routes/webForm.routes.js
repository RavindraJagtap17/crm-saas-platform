const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/webForm.controller");

const router = express.Router();

// Tenant Admin only — matches every other tenant-configuration resource
// (statuses, sources, products, custom fields).
router.use(authenticate, tenantScope, requireRole("tenant_admin"));

router.get("/", controller.list);
router.post("/", controller.create);
router.patch("/:id", validateIdParam(), controller.update);

module.exports = router;
