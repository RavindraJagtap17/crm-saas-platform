const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/superAdmin.controller");

const router = express.Router();

// Platform-level only — tenantScope resolves req.tenantId to null here
// (super_admin carries no tenant), and every handler below operates
// across tenants deliberately, unlike everything else in the API.
router.use(authenticate, tenantScope, requireRole("super_admin"));

router.get("/overview", controller.overview);
router.get("/tenants", controller.listTenants);
router.get("/tenants/:id", validateIdParam(), controller.getTenant);
router.patch("/tenants/:id/employee-limit", validateIdParam(), controller.updateEmployeeLimit);
router.patch("/tenants/:id/status", validateIdParam(), controller.updateStatus);

module.exports = router;
