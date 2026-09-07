const tenantModel = require("../models/tenantModel");
const clientModel = require("../models/clientModel");
const clientLicenseModel = require("../models/clientLicenseModel");

/**
 * "Agency pays per Client" restructure — replaces the two lazy-evaluation
 * checks this file used to make (agencyGracePeriodExpired against
 * agency_subscriptions, clientSubscriptionInactive against
 * client_subscriptions): there is no Agency-level subscription any more
 * (Agency signup is free; tenants.status alone is now the whole Agency
 * gate — see requireActiveTenant's own comment below), and Client access
 * is no longer gated by a Client<->Agency subscription at all, but by
 * whether the AGENCY has paid for that Client's own License
 * (client_licenses, migration 054).
 *
 * No grace period: the finalized business rule is "a lapsed Client
 * license locks that Client's workspace" outright, not a soft window —
 * so unlike the old clientSubscriptionInactive, there is no
 * grace_period-vs-expired distinction to make here. Still lazy/no-
 * scheduler, same discipline as everything else in this file: nothing
 * proactively flips client_licenses.status to 'expired' in the
 * background (see clientLicenseService.effectiveStatus's own identical
 * reasoning) — current_period_end is re-checked fresh on every request.
 */
function clientLicenseInactive(license) {
  if (!license) return true; // never purchased
  if (license.status !== "active") return true; // 'pending' (awaiting payment) or 'expired'
  if (!license.current_period_end) return true;
  return new Date(license.current_period_end).getTime() < Date.now();
}

/**
 * §I, extended one level for the B2B2C restructure: blocks CRM "interior"
 * access for a caller whose scope isn't active. Must run after
 * tenantScope. Deliberately re-reads CURRENT status from the database on
 * every request rather than trusting the access token's claims — the
 * token only carries role/tenantId/clientId (stateless-by-design access
 * token), and a token minted 5 minutes ago must not still grant access to
 * a client an Agency Admin just deactivated, or one whose License just
 * lapsed, a second ago.
 *
 * Gating rule per the finalized "Agency pays per Client" model:
 *  - super_admin: never gated.
 *  - agency_admin: gated on tenants.status = 'active' only (their own
 *    agency) — no subscription concept left to check at all; Agency
 *    signup is free, so the only way tenants.status is ever non-'active'
 *    here is a manual Super Admin action.
 *  - client_admin / client_employee: gated on clients.status = 'active'
 *    AND the owning agency's tenants.status = 'active' AND that specific
 *    Client's own License being currently active (paid for by the
 *    Agency, not by the Client — there is no Client-side recovery route
 *    any more; only the Agency Admin can renew it).
 */
async function requireActiveTenant(req, res, next) {
  if (req.user.role === "super_admin") return next();

  if (req.user.role === "agency_admin") {
    if (!req.tenantId) {
      return res.status(403).json({ error: "Account has no agency context." });
    }
    const tenant = await tenantModel.findById(req.tenantId);
    if (!tenant) {
      return res.status(403).json({ error: "Agency not found." });
    }
    if (tenant.status !== "active") {
      return res.status(403).json({
        error: "Your agency's account is not active. Please contact the platform administrator.",
        code: "TENANT_NOT_ACTIVE",
        tenantStatus: tenant.status,
      });
    }
    return next();
  }

  if (req.user.role === "client_admin" || req.user.role === "client_employee") {
    if (!req.clientId || !req.tenantId) {
      return res.status(403).json({ error: "Account has no client context." });
    }
    const client = await clientModel.findById(req.tenantId, req.clientId);
    if (!client) {
      return res.status(403).json({ error: "Client not found." });
    }
    if (client.status !== "active") {
      return res.status(403).json({
        error: "This client has been deactivated. Contact your agency administrator.",
        code: "CLIENT_NOT_ACTIVE",
        clientStatus: client.status,
      });
    }
    const tenant = await tenantModel.findById(req.tenantId);
    if (!tenant || tenant.status !== "active") {
      return res.status(403).json({
        error: "Your agency's account is not active. Contact your agency administrator.",
        code: "TENANT_NOT_ACTIVE",
        tenantStatus: tenant?.status || "unknown",
      });
    }
    const license = await clientLicenseModel.findByClient(req.clientId);
    if (clientLicenseInactive(license)) {
      return res.status(403).json({
        error: "This client's license is not active. Contact your agency administrator to renew it.",
        code: "CLIENT_LICENSE_NOT_ACTIVE",
      });
    }
    return next();
  }

  return res.status(403).json({ error: "Account has no recognized scope context." });
}

module.exports = requireActiveTenant;
