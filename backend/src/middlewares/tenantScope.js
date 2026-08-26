/**
 * Must run after `authenticate`. Sets req.tenantId from the verified
 * access token only. This is the one and only source it ever reads from
 * — never req.body, req.query, req.params, or any header — so a request
 * can never claim a different tenant than the one its token was issued
 * for. This is the foundation every future tenant-owned-data route
 * builds its isolation on (§9 of the Final Specification).
 */
function tenantScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (req.user.role === "super_admin") {
    req.tenantId = null;
    return next();
  }

  if (!req.user.tenantId) {
    return res.status(403).json({ error: "Account has no tenant context" });
  }

  req.tenantId = req.user.tenantId;
  return next();
}

module.exports = tenantScope;
