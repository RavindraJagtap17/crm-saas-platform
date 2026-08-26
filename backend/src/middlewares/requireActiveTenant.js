const tenantModel = require("../models/tenantModel");

/**
 * §I: blocks CRM "interior" access for a tenant that isn't active —
 * pending_payment, suspended, or canceled. Must run after tenantScope.
 * Deliberately re-reads the tenant's CURRENT status from the database on
 * every request rather than trusting the access token's claims: the token
 * only carries role/tenantId (§3's stateless-by-design access token), and
 * a token minted 5 minutes ago must not still grant access to a tenant a
 * Razorpay webhook just suspended a second ago — the whole point of §G/§H
 * is that this state can change at any moment, authoritatively, outside
 * the request that's asking.
 *
 * Never applied to: auth routes, billing routes (must stay reachable to
 * let a pending_payment tenant actually pay), or any Super Admin route —
 * super_admin carries no tenant at all and is explicitly never gated by
 * this (§H/§I).
 */
async function requireActiveTenant(req, res, next) {
  if (req.user.role === "super_admin") return next();

  if (!req.tenantId) {
    return res.status(403).json({ error: "Account has no tenant context." });
  }

  const tenant = await tenantModel.findById(req.tenantId);
  if (!tenant) {
    return res.status(403).json({ error: "Tenant not found." });
  }
  if (tenant.status !== "active") {
    return res.status(403).json({
      error: "Your agency's subscription is not active. Please complete billing setup or contact your administrator.",
      code: "TENANT_NOT_ACTIVE",
      tenantStatus: tenant.status,
    });
  }

  return next();
}

module.exports = requireActiveTenant;
