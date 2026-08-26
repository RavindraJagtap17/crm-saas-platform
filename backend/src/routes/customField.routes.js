const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/customField.controller");

const router = express.Router();

router.use(authenticate, tenantScope, requireRole("tenant_admin", "tenant_employee"));

router.get("/", controller.list);
router.post("/", requireRole("tenant_admin"), controller.create);
router.patch("/:id", validateIdParam(), requireRole("tenant_admin"), controller.update);

module.exports = router;
