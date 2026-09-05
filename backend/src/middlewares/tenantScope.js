/**
 * Must run after `authenticate`. Sets req.tenantId and req.clientId from
 * the verified access token ONLY — never req.body, req.query, req.params,
 * or any header, so a request can never claim a different scope than the
 * one its token was issued for. This is the foundation every tenant/
 * client-owned-data route builds its isolation on (§9 of the Final
 * Specification, extended one level for the B2B2C restructure).
 *
 * Per-role scope, exactly per the approved B2B2C model:
 *  - super_admin: tenantId = null, clientId = null (platform-wide, never
 *    scoped to either level).
 *  - agency_admin: tenantId = their own agency (from the token), clientId
 *    = null (an Agency Admin has no single "current client").
 *  - client_admin / client_employee: clientId = their own client (from the
 *    token), tenantId = that client's owning agency — ALSO already on the
 *    token (resolved via clients.tenant_id at issuance time, see jwt.js),
 *    not re-derived here. Both are needed: clientId for CRM-data scoping,
 *    tenantId for branding display and the two-level active-status gate.
 */
function tenantScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (req.user.role === "super_admin") {
    req.tenantId = null;
    req.clientId = null;
    return next();
  }

  if (req.user.role === "agency_admin") {
    if (!req.user.tenantId) {
      return res.status(403).json({ error: "Account has no agency context" });
    }
    req.tenantId = req.user.tenantId;
    req.clientId = null;
    return next();
  }

  if (req.user.role === "client_admin" || req.user.role === "client_employee") {
    if (!req.user.clientId) {
      return res.status(403).json({ error: "Account has no client context" });
    }
    req.clientId = req.user.clientId;
    // Present for every client-level token (resolved at issuance), but
    // guarded rather than assumed — a token issued before this field
    // existed, or a data inconsistency, must not silently scope as if it
    // were an agency-wide caller.
    req.tenantId = req.user.tenantId || null;
    return next();
  }

  return res.status(403).json({ error: "Account has no recognized scope context" });
}

module.exports = tenantScope;
