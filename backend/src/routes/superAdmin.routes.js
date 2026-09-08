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

// Super Admin Client detail (§3 of the license-monitoring feature) —
// clientModel.findById(tenantId, clientId) inside the service verifies
// the Client actually belongs to :tenantId, so a mismatched pair 404s
// rather than leaking another Agency's Client.
router.get(
  "/tenants/:tenantId/clients/:clientId",
  validateIdParam("tenantId"),
  validateIdParam("clientId"),
  controller.getClient
);

// "Agency pays per Client" restructure: the ONE price an Agency pays per
// Client added. Never touches Razorpay itself. Replaces every prior
// Agency-billing route this router used to expose (the Step-9 local plan
// catalog, its any-tenant subscription override, and the flat
// single-Agency-plan model that superseded it in turn) — all removed in
// this same restructure.
router.get("/client-license-price", controller.getClientLicensePrice);
router.put("/client-license-price", controller.upsertClientLicensePrice);

// Platform-wide integration event monitoring — deliberately combines the
// filtered list AND its matching summary counts into one response (same
// "bundle related data in one call" shape /overview above already uses)
// rather than a separate /summary endpoint, since both would otherwise
// need to duplicate the exact same query params on every request.
// :id is intentionally NOT nested under /tenants/:tenantId the way
// getClient is — Super Admin identifies an event by its own id and looks
// UP the Agency/Client from there (see integrationMonitoringService),
// mirroring how the query filters themselves work (agencyId/clientId are
// optional search criteria, not a required path).
router.get("/integration-events", controller.listIntegrationEvents);
router.get("/integration-events/:id", validateIdParam(), controller.getIntegrationEvent);
// Manual "Retry Now" — nested under the event id, matching this
// resource's own convention (:id identifies the event; there is no
// request body). See integrationMonitoringService.retryEvent for the
// eligibility/claim/audit logic — this route contributes no logic of its
// own beyond identifying the event and the acting Super Admin.
router.post("/integration-events/:id/retry", validateIdParam(), controller.retryIntegrationEvent);
// Retry History — read-only, same :id-nested shape as retry above.
router.get("/integration-events/:id/retry-history", validateIdParam(), controller.getIntegrationEventRetryHistory);

module.exports = router;
