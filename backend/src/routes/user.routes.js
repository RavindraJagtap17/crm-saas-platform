const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/user.controller");

const router = express.Router();

// Client Admin only, throughout — team management is not part of an
// employee's job (§L), and doubles as the source of the assignment
// dropdown on the leads UI. Client-scoped: this manages one client's own
// employees, not the whole agency.
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin"));

router.get("/", controller.list);
router.post("/invite", controller.invite);
router.post("/invitations/:id/cancel", validateIdParam(), controller.cancelInvitation);
router.patch("/:id/status", validateIdParam(), controller.setStatus);

module.exports = router;
