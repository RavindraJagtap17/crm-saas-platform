const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const controller = require("../controllers/auth.controller");

const router = express.Router();

router.post("/google", controller.googleSignIn);
router.post("/signup", controller.signupAgency);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);

router.get("/me", authenticate, tenantScope, controller.me);

// --- Minimal test endpoints for verifying Step 3 only (not CRM routes) ---

router.get("/test-role/super-admin", authenticate, tenantScope, requireRole("super_admin"), (req, res) => {
  res.json({ ok: true, role: req.user.role, tenantId: req.tenantId });
});

router.get("/test-role/tenant-admin", authenticate, tenantScope, requireRole("tenant_admin"), (req, res) => {
  res.json({ ok: true, role: req.user.role, tenantId: req.tenantId });
});

router.get("/test-role/employee", authenticate, tenantScope, requireRole("tenant_employee"), (req, res) => {
  res.json({ ok: true, role: req.user.role, tenantId: req.tenantId });
});

// Example of a route shared by more than one role.
router.get(
  "/test-role/shared",
  authenticate,
  tenantScope,
  requireRole("tenant_admin", "tenant_employee"),
  (req, res) => {
    res.json({ ok: true, role: req.user.role, tenantId: req.tenantId });
  }
);

module.exports = router;
