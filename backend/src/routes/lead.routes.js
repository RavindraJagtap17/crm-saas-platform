const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const { csvUploadSingle } = require("../middlewares/csvUpload");
const controller = require("../controllers/lead.controller");
const followUpController = require("../controllers/leadFollowUp.controller");

const router = express.Router();

// Every route here requires a real session and a resolved client. Super
// Admin and Agency Admin are deliberately excluded from all of them (§B/§L,
// extended for B2B2C: leads belong to a Client, not the agency, and are not
// part of either platform- or agency-level role's job). requireActiveTenant
// (Step 9 §I, now two-level) blocks a suspended/canceled agency OR a
// deactivated client from the CRM interior — leads are the core of that
// interior.
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin", "client_employee"));

router.post("/", controller.create);
router.get("/", controller.list);

// Bulk actions — registered BEFORE the /:id routes below: Express would
// otherwise match "bulk" itself as the :id segment of /:id/assign or
// /:id/status (both are the same 2-segment shape as /bulk/assign,
// /bulk/status), routing a bulk request into the single-lead handler with
// id="bulk" and a confusing validateIdParam() 400 instead of reaching
// these. Same per-action permission split as their single-lead
// counterparts: bulk assign is client_admin-only (matching :id/assign);
// bulk status change has no extra role restriction (matching :id/status,
// open to client_employee too) — see leadService.bulkAssignLeads/
// bulkChangeStatus for why that split is deliberate, not an oversight.
router.post("/bulk/assign", requireRole("client_admin"), controller.bulkAssign);
router.post("/bulk/status", controller.bulkChangeStatus);

// CSV Export — Client Admin only. Unlike bulk status change, there is no
// pre-existing single-lead "export" permission to inherit from (export is
// a brand new capability), so per this task's own default rule ("no role
// gets a new capability just because the UI could render a button for
// it"), this stays admin-only rather than mirroring changeStatus's open
// permission. /export is a single-segment GET, same shape as /:id — must
// be registered before that route below for the same reason /bulk/* is
// registered above it.
router.get("/export", requireRole("client_admin"), controller.exportFiltered);
router.post("/export-selected", requireRole("client_admin"), controller.exportSelected);

// CSV Import — Client Admin only (higher-risk mutation, same default as
// export: no pre-existing single-lead "import" permission to inherit, so
// no role gets it just because the UI could render a button). Two steps,
// same shape as export's own two endpoints: preview (multipart upload,
// csvUploadSingle puts the parsed buffer on req.file) then confirm (plain
// JSON body, just the one-time token — see leadImportService for why no
// other import data is ever re-sent by the browser). "import/preview" and
// "import" are both registered here, before /:id below, for the same
// routing-collision reason /bulk/* and /export/* are.
router.post("/import/preview", requireRole("client_admin"), csvUploadSingle("file"), controller.previewImport);
router.post("/import", requireRole("client_admin"), controller.confirmImport);

router.get("/:id", validateIdParam(), controller.get);
router.patch("/:id", validateIdParam(), controller.update);
router.put("/:id", validateIdParam(), controller.update);
router.delete("/:id", validateIdParam(), requireRole("client_admin"), controller.remove);

// Action endpoints: each of these writes a companion audit row
// (lead_status_history / lead_activities) alongside the field update, so
// they're POST rather than folded into the generic PATCH above.
router.post("/:id/status", validateIdParam(), controller.changeStatus);
router.post("/:id/assign", validateIdParam(), requireRole("client_admin"), controller.assign);

router.get("/:id/activities", validateIdParam(), controller.listActivities);
router.post("/:id/activities", validateIdParam(), controller.createActivity);

// Follow-up scheduling (§3): nested under a specific lead only for
// creation — listing/reading/mutating an existing follow-up goes through
// /api/follow-ups (leadFollowUp.routes.js), which already supports
// `?leadId=` filtering, so there's no need for a second, duplicate list
// route here.
router.post("/:id/follow-ups", validateIdParam(), followUpController.createForLead);

module.exports = router;
