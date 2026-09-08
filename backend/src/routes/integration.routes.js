const express = require("express");
const authenticate = require("../middlewares/authenticate");
const tenantScope = require("../middlewares/tenantScope");
const requireActiveTenant = require("../middlewares/requireActiveTenant");
const requireRole = require("../middlewares/requireRole");
const validateIdParam = require("../middlewares/validateIdParam");
const controller = require("../controllers/integration.controller");

const router = express.Router({ mergeParams: true });

// Generic Client Admin management surface (§10 of the foundation task) —
// same gate meta.routes.js already uses for its own equivalent endpoints
// (both client and agency must be active, Client Admin only). No public/
// webhook route lives here yet — this task deliberately adds none; a
// future provider task mounts its own `/api/integrations/:provider/webhook`
// alongside this router, public and unauthenticated like Meta's, never
// behind this gate.
router.use(authenticate, tenantScope, requireActiveTenant, requireRole("client_admin"));

router.get("/:provider/connection", controller.getConnection);
router.patch("/:provider/connection", controller.updateConnection);
router.delete("/:provider/connection", controller.disconnect);

router.get("/:provider/mappings", controller.listMappings);
router.post("/:provider/mappings", controller.createMapping);
router.patch("/:provider/mappings/:id", validateIdParam(), controller.updateMapping);
router.delete("/:provider/mappings/:id", validateIdParam(), controller.removeMapping);

router.get("/:provider/events", controller.listEvents);

module.exports = router;
