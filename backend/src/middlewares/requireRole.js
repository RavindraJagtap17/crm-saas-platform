/**
 * Reusable RBAC gate: requireRole("client_admin"), requireRole("client_admin",
 * "client_employee"), etc. Must run after `authenticate`. This is only the
 * mechanism — which roles a given route allows is decided by that route,
 * not by any logic in here.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to access this resource" });
    }
    return next();
  };
}

module.exports = requireRole;
