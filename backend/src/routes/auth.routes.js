const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireRole = require("../middlewares/requireRole");
const { signInLimiter, refreshLimiter } = require("../middlewares/authRateLimit");
const controller = require("../controllers/auth.controller");
const config = require("../config");

const router = express.Router();

router.post("/google", signInLimiter, controller.googleSignIn);
router.post("/signup", signInLimiter, controller.signupAgency);
router.post("/refresh", refreshLimiter, controller.refresh);
router.post("/logout", controller.logout);

router.get("/me", authenticate, tenantScope, controller.me);

// C16: development-only login, bypassing Google Sign-In entirely for local
// testing of all 4 roles. Route registration itself is gated by
// NODE_ENV — in production this route simply does not exist in the route
// table (a request to it falls through to notFound, same as any other
// unknown path), not merely refused inside the handler.
if (!config.isProduction) {
  router.post("/dev-login", signInLimiter, controller.devLogin);
}

// --- Minimal test endpoints for verifying Step 3 / the B2B2C scope model only (not CRM routes) ---

router.get("/test-role/super-admin", authenticate, tenantScope, requireRole("super_admin"), (req, res) => {
  res.json({ ok: true, role: req.user.role, tenantId: req.tenantId, clientId: req.clientId });
});

router.get("/test-role/agency-admin", authenticate, tenantScope, requireRole("agency_admin"), (req, res) => {
  res.json({ ok: true, role: req.user.role, tenantId: req.tenantId, clientId: req.clientId });
});

router.get("/test-role/client-admin", authenticate, tenantScope, requireRole("client_admin"), (req, res) => {
  res.json({ ok: true, role: req.user.role, tenantId: req.tenantId, clientId: req.clientId });
});

router.get("/test-role/client-employee", authenticate, tenantScope, requireRole("client_employee"), (req, res) => {
  res.json({ ok: true, role: req.user.role, tenantId: req.tenantId, clientId: req.clientId });
});

// Example of a route shared by more than one role.
router.get(
  "/test-role/shared",
  authenticate,
  tenantScope,
  requireRole("client_admin", "client_employee"),
  (req, res) => {
    res.json({ ok: true, role: req.user.role, tenantId: req.tenantId, clientId: req.clientId });
  }
);

module.exports = router;
