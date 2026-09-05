const clientSubscriptionModel = require("../models/clientSubscriptionModel");
const clientSubscriptionPlanModel = require("../models/clientSubscriptionPlanModel");
const userModel = require("../models/userModel");
const employeeInvitationModel = require("../models/employeeInvitationModel");
const httpError = require("../utils/httpError");

/**
 * Step 11A — Client employee-seat accounting. Deliberately its own file
 * (not folded into userService/clientBillingService) since it reads
 * across three tables (client_subscriptions, client_subscription_plans,
 * users, employee_invitations) for one single-purpose calculation, reused
 * by both the read path (GET /users) and every capacity-checked write
 * path (invite, reactivate).
 *
 * Employee-limit source: EXCLUSIVELY client_subscriptions.plan_id ->
 * client_subscription_plans.max_active_employees for the CLIENT's own
 * subscription — never tenants.employee_limit or
 * subscription_plans.max_clients (different concepts: the former doesn't
 * exist in this schema for employees, the latter caps how many CLIENTS an
 * AGENCY may have, unrelated to any one Client's employee seats).
 *
 * "Current effective plan" is always subscription.plan_id — NEVER
 * next_plan_id (a scheduled downgrade not yet in effect) or
 * pending_upgrade_plan_id (an upgrade payment not yet confirmed). Both of
 * those only ever become the effective limit once clientPaymentWebhookService
 * actually commits them onto plan_id (Step 9B/10) — this function simply
 * never reads them, so there is nothing to gate here; the limit is
 * correct automatically the instant plan_id changes.
 */
async function getEmployeeSeatUsage(clientId, conn) {
  const subscription = await clientSubscriptionModel.findByClient(clientId, conn);
  if (!subscription || !["active", "grace_period"].includes(subscription.status)) {
    // Structurally unreachable via the HTTP routes (requireActiveTenant
    // already blocks a client_admin/client_employee whose subscription
    // isn't active/grace_period from reaching any employee-management
    // endpoint at all) — handled defensively rather than assumed, per
    // this codebase's "never assume, always scope/check" discipline.
    throw httpError("This client has no active subscription.", 400, "NO_ACTIVE_SUBSCRIPTION");
  }

  const plan = await clientSubscriptionPlanModel.findById(subscription.tenant_id, subscription.plan_id);
  if (!plan) {
    throw httpError("The client's current plan could not be found.", 500, "PLAN_NOT_FOUND");
  }

  const [activeEmployees, pendingInvitations] = await Promise.all([
    userModel.countActiveEmployeesForClient(clientId, conn),
    employeeInvitationModel.countPendingForClient(clientId, conn),
  ]);

  const employeeLimit = plan.max_active_employees;
  const usedSeats = activeEmployees + pendingInvitations;
  const availableSeats = Math.max(employeeLimit - usedSeats, 0);
  const hasCapacity = usedSeats < employeeLimit;

  return { activeEmployees, pendingInvitations, usedSeats, employeeLimit, availableSeats, hasCapacity };
}

function serializeSeatUsage(usage) {
  return {
    activeEmployees: usage.activeEmployees,
    pendingInvitations: usage.pendingInvitations,
    usedSeats: usage.usedSeats,
    employeeLimit: usage.employeeLimit,
    availableSeats: usage.availableSeats,
    hasCapacity: usage.hasCapacity,
  };
}

module.exports = { getEmployeeSeatUsage, serializeSeatUsage };
