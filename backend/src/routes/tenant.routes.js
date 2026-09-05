const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/tenant.controller");

const router = express.Router();

// Branding is agency-owned and agency-editable, but READ access is now
// shared with client-level roles (post-Phase-D fix: Client Admin/Employee
// display their owning agency's branding). req.tenantId is already the
// resolved agency for every role here — agency_admin from their own
// users.tenant_id, client_admin/employee via clients.tenant_id (resolved
// at JWT issuance, see jwt.js/tenantScope.js) — so getOwnTenant() needs no
// change: it was always "the tenant this token's owner belongs to",
// never "my own row specifically".
router.use(authenticate, tenantScope, requireRole("agency_admin", "client_admin", "client_employee"));

// GET is deliberately NOT gated by requireActiveTenant (Step 9 §I): a
// pending_payment/suspended agency still needs to read its own tenant.status
// (the frontend's billing page relies on this — see agency-billing.js), and
// a blocked client-level user's own account-inactive page still wants to
// show correct branding. Branding EDITS remain agency_admin-only.
router.get("/", controller.getOwn);
router.patch("/", requireActiveTenant, requireRole("agency_admin"), controller.updateOwn);

module.exports = router;
