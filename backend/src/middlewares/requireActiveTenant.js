const tenantModel = require("../models/tenantModel");
const clientModel = require("../models/clientModel");
const agencySubscriptionModel = require("../models/agencySubscriptionModel");
const clientSubscriptionModel = require("../models/clientSubscriptionModel");

/**
 * New business model: an Agency's grace period has a fixed local 7-day
 * deadline (agency_subscriptions.grace_period_ends_at) that nothing
 * proactively sweeps in the background — no scheduler exists in this
 * codebase (a deliberate, reported limitation of this step, not an
 * oversight) — so it must be evaluated lazily, live, on every request,
 * exactly like every other freshness check in this middleware.
 * tenants.status deliberately stays 'active' throughout the grace period
 * itself (see razorpayWebhookService.tenantStatusForAgencySubscription) —
 * this is the one additional place that locks access once the deadline
 * has actually passed. Tenants with no agency_subscriptions row at all
 * (any tenant still on the old flow) are unaffected — this always
 * resolves to false for them.
 */
async function agencyGracePeriodExpired(tenantId) {
  const subscription = await agencySubscriptionModel.findByTenant(tenantId);
  if (!subscription || subscription.status !== "grace_period" || !subscription.grace_period_ends_at) {
    return false;
  }
  return new Date(subscription.grace_period_ends_at).getTime() < Date.now();
}

/**
 * Step 7: "Client CRM requires Agency subscription = active AND Client
 * status = active AND Client subscription = active." No subscription row
 * at all counts as inactive (a Client who has never chosen a plan has no
 * active subscription by definition) — this is a real, business-rule-
 * mandated behavior change for any pre-existing Client created before this
 * step that has no client_subscriptions row yet; see the Step 7 report.
 * 'grace_period' is treated as active only while its own deadline hasn't
 * passed yet — the same lazy, no-scheduler-required evaluation already
 * established for agencyGracePeriodExpired above, reused for consistency.
 */
async function clientSubscriptionInactive(clientId) {
  const subscription = await clientSubscriptionModel.findByClient(clientId);
  if (!subscription) return true;
  if (subscription.status === "active") return false;
  if (subscription.status === "grace_period" && subscription.grace_period_ends_at) {
    return new Date(subscription.grace_period_ends_at).getTime() < Date.now();
  }
  return true;
}

/**
 * §I, extended one level for the B2B2C restructure: blocks CRM "interior"
 * access for a caller whose scope isn't active. Must run after
 * tenantScope. Deliberately re-reads CURRENT status from the database on
 * every request rather than trusting the access token's claims — the
 * token only carries role/tenantId/clientId (stateless-by-design access
 * token), and a token minted 5 minutes ago must not still grant access to
 * an agency a Razorpay webhook just suspended, or a client an Agency Admin
 * just deactivated, a second ago.
 *
 * Gating rule per the approved model:
 *  - super_admin: never gated.
 *  - agency_admin: gated on tenants.status = 'active' only (their own
 *    agency). Never applied to billing/tenant-status-reading routes —
 *    those must stay reachable so a pending_payment/suspended agency can
 *    actually recover (§H/§I carve-out, unchanged).
 *  - client_admin / client_employee: gated on BOTH clients.status =
 *    'active' AND the owning agency's tenants.status = 'active' — a
 *    client under a suspended/canceled agency must lose CRM access even
 *    if the client row itself is still marked active, and a deactivated
 *    client must lose access even if its agency is fine.
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
        error: "Your agency's subscription is not active. Please complete billing setup or contact your administrator.",
        code: "TENANT_NOT_ACTIVE",
        tenantStatus: tenant.status,
      });
    }
    if (await agencyGracePeriodExpired(req.tenantId)) {
      return res.status(403).json({
        error: "Your agency's subscription grace period has ended. Please complete payment to restore access.",
        code: "TENANT_GRACE_PERIOD_EXPIRED",
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
        error: "Your agency's subscription is not active. Contact your agency administrator.",
        code: "TENANT_NOT_ACTIVE",
        tenantStatus: tenant?.status || "unknown",
      });
    }
    if (await agencyGracePeriodExpired(req.tenantId)) {
      return res.status(403).json({
        error: "Your agency's subscription grace period has ended. Contact your agency administrator.",
        code: "TENANT_GRACE_PERIOD_EXPIRED",
      });
    }
    if (await clientSubscriptionInactive(req.clientId)) {
      return res.status(403).json({
        error: "This client's subscription is not active. Visit Billing to choose a plan or complete payment.",
        code: "CLIENT_SUBSCRIPTION_NOT_ACTIVE",
      });
    }
    return next();
  }

  return res.status(403).json({ error: "Account has no recognized scope context." });
}

module.exports = requireActiveTenant;
