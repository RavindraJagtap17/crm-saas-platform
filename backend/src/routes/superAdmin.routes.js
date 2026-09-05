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
router.post("/tenants", controller.createAgency);
router.get("/tenants/:id", validateIdParam(), controller.getTenant);
router.post("/tenants/:id/invite-admin", validateIdParam(), controller.inviteAgencyAdmin);
router.patch("/tenants/:id/status", validateIdParam(), controller.updateStatus);

// Step 9: local plan catalog (§B/§P) — never touches Razorpay itself,
// only this app's own reference/availability record of it.
router.get("/plans", controller.listPlans);
router.post("/plans", controller.createPlan);
router.patch("/plans/:id", validateIdParam(), controller.updatePlan);
router.patch("/plans/:id/active", validateIdParam(), controller.setPlanActive);

// New business model: exactly ONE Agency plan — Super Admin sets/updates
// its price. Never touches Razorpay itself, same as the Step 9 catalog
// above; separate route/table (agency_subscription_plan, migration 041),
// left independent of the Step 9 multi-plan catalog.
router.get("/agency-plan", controller.getAgencyPlan);
router.put("/agency-plan", controller.upsertAgencyPlan);
router.get("/tenants/:id/agency-subscription", validateIdParam(), controller.getTenantAgencySubscription);

// Step 9: any-tenant subscription override (§K).
router.get("/tenants/:id/subscription", validateIdParam(), controller.getTenantSubscription);
router.patch("/tenants/:id/subscription/plan", validateIdParam(), controller.changeTenantPlan);
router.post("/tenants/:id/subscription/suspend", validateIdParam(), controller.suspendTenantSubscription);
router.post("/tenants/:id/subscription/resume", validateIdParam(), controller.resumeTenantSubscription);
router.post("/tenants/:id/subscription/cancel", validateIdParam(), controller.cancelTenantSubscription);

module.exports = router;
