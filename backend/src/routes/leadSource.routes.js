const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/leadSource.controller");

const router = express.Router();

router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin", "client_employee"));

router.get("/", controller.list);
router.post("/", requireRole("client_admin"), controller.create);
router.patch("/:id", validateIdParam(), requireRole("client_admin"), controller.update);

module.exports = router;
