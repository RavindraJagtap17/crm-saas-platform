const userModel = require("../models/userModel");
const roleModel = require("../models/roleModel");
const employeeInvitationModel = require("../models/employeeInvitationModel");
const clientSubscriptionModel = require("../models/clientSubscriptionModel");
const employeeSeatService = require("./employeeSeatService");
const withTransaction = require("../utils/withTransaction");
const httpError = require("../utils/httpError");
const { validateInvite, validateStatusChange } = require("../validators/userValidators");

// B2B2C restructure: this service is CLIENT-scoped — a Client Admin
// managing their own client's team (client_employee only; a co-Client-Admin
// is not something a Client Admin can create — that's the Agency Admin's
// job one level up, see clientService.inviteClientAdmin, untouched by
// this step and never subject to the employee-seat limit below).
//
// Step 11A: employee count is now subscription-plan-limited (Confirmed
// Business Rules) — see employeeSeatService.getEmployeeSeatUsage for the
// exact source (client_subscriptions.plan_id ->
// client_subscription_plans.max_active_employees) and this file's
// invite()/reactivate() for how capacity is enforced under concurrency.
const INVITABLE_ROLES = ["client_employee"];
const INVITATION_EXPIRY_DAYS = 7; // matches migration 046's own documented convention; expiry ENFORCEMENT is a later step's scheduler, not this one.

function serialize(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    role: user.role_name,
    status: user.status,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

function serializeInvitation(invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    name: invitation.name,
    status: invitation.status,
    expiresAt: invitation.expires_at,
    createdAt: invitation.created_at,
  };
}

async function list(clientId) {
  const [users, invitations, seatUsage] = await Promise.all([
    userModel.listByClient(clientId),
    employeeInvitationModel.listPendingForClient(clientId),
    employeeSeatService.getEmployeeSeatUsage(clientId),
  ]);
  return {
    users: users.map(serialize),
    invitations: invitations.map(serializeInvitation),
    seatUsage: employeeSeatService.serializeSeatUsage(seatUsage),
  };
}

/**
 * Step 11A — creates a pending employee_invitations row (the seat
 * reservation) AND the existing users(status='invited') row (unchanged,
 * so Google-Sign-In activation keeps working exactly as before) —
 * atomically, under the SAME lock used by every other capacity-checked
 * write in this file: a `SELECT ... FOR UPDATE` on the Client's own
 * client_subscriptions row (clientSubscriptionModel.findByClientForUpdate,
 * the same primitive Step 8B's chooseSubscription established). Two
 * concurrent invite requests for the SAME client necessarily serialize on
 * this lock, so the second one's capacity check always sees the first
 * one's already-committed reservation — "two simultaneous invitations
 * both see one remaining seat and both succeed" is structurally
 * impossible.
 *
 * "Do not create user... do not create invitation... do not partially
 * modify anything" on rejection is automatic here: the capacity check
 * happens BEFORE either INSERT, inside the same transaction that gets
 * rolled back entirely if httpError throws.
 */
async function invite(clientId, body, actorUserId) {
  const clean = validateInvite(body, INVITABLE_ROLES);

  const existing = await userModel.findByEmail(clean.email);
  if (existing) {
    throw httpError("An account already exists for this email.", 409, "ACCOUNT_EXISTS");
  }

  const role = await roleModel.findByName(clean.role);
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const { user, invitation } = await withTransaction(async (conn) => {
    await clientSubscriptionModel.findByClientForUpdate(conn, clientId);
    const usage = await employeeSeatService.getEmployeeSeatUsage(clientId, conn);
    if (!usage.hasCapacity) {
      throw httpError(
        `Employee limit reached (${usage.usedSeats}/${usage.employeeLimit} seats used). Cancel a pending invitation, deactivate an employee, or upgrade your plan.`,
        409,
        "EMPLOYEE_LIMIT_REACHED"
      );
    }

    const createdUser = await userModel.createInvitedForClient(clientId, { email: clean.email, name: clean.name, roleId: role.id }, conn);
    const createdInvitation = await employeeInvitationModel.create(conn, clientId, {
      email: clean.email,
      name: clean.name,
      invitedBy: actorUserId,
      expiresAt,
    });
    return { user: createdUser, invitation: createdInvitation };
  });

  return { user: serialize(user), invitation: serializeInvitation(invitation) };
}

/**
 * Step 11A — Client Admin cancels a still-pending invitation: releases
 * the seat immediately (employee_invitations.status='cancelled', its own
 * existing status — never invented) and deletes the corresponding
 * never-activated users row so the email is free to be re-invited
 * (users.email is globally UNIQUE; see userModel.deleteInvitedByClientAndEmail's
 * own comment). Client-scoped (findByIdForClient-equivalent guard is
 * built into employeeInvitationModel.cancel's own WHERE clause) — a
 * cross-Client id, or one that's already accepted/cancelled/expired,
 * simply matches no row.
 */
async function cancelInvitation(clientId, invitationId) {
  const invitation = await employeeInvitationModel.findByIdForClient(clientId, invitationId);
  if (!invitation) {
    throw httpError("Invitation not found.", 404, "INVITATION_NOT_FOUND");
  }
  if (invitation.status !== "pending") {
    // Existing status semantics only — accepted/cancelled/expired are all
    // simply "nothing left to cancel," reported plainly rather than
    // inventing a new outcome for each.
    throw httpError(`This invitation is already '${invitation.status}' and cannot be cancelled.`, 400, "INVITATION_NOT_PENDING");
  }

  const cancelled = await employeeInvitationModel.cancel(clientId, invitationId);
  if (!cancelled) {
    // Lost a race with something else resolving this same invitation
    // (e.g. the person activated it a moment ago) between the read above
    // and this write — safe to just report the conflict.
    throw httpError("This invitation was just resolved and can no longer be cancelled.", 409, "INVITATION_STATE_CHANGED");
  }
  await userModel.deleteInvitedByClientAndEmail(clientId, invitation.email);

  return serializeInvitation(cancelled);
}

/**
 * Step 11A — deactivate/reactivate, now with the protections the
 * business rules require: never a client_admin (self or otherwise —
 * this router is client_admin-only to begin with, so "self" and "another
 * client_admin" are the same guard), never an 'invited' row (that has no
 * meaning here — cancel the invitation instead; also prevents a stale
 * employee_invitations row from silently going out of sync with a
 * users row this endpoint touched directly), and reactivation is
 * capacity-checked under the SAME client_subscriptions row lock invite()
 * uses, closing the identical concurrent-reactivation race.
 */
async function setStatus(clientId, id, body) {
  const status = validateStatusChange(body);

  const target = await userModel.findByIdForClient(clientId, id);
  if (!target) throw httpError("User not found.", 404);
  if (target.role_name === "client_admin") {
    throw httpError("Client Admin accounts cannot be deactivated or reactivated here.", 403, "CANNOT_MODIFY_CLIENT_ADMIN");
  }
  if (target.status === "invited") {
    throw httpError("This account has a pending invitation — cancel the invitation instead.", 400, "ACCOUNT_STILL_INVITED");
  }

  if (status === "deactivated") {
    const updated = await userModel.deactivateForClient(clientId, id);
    if (!updated) throw httpError("This account is not currently active.", 409, "ACCOUNT_STATE_CHANGED");
    return serialize(updated);
  }

  // status === "active" -> reactivation, capacity-checked.
  const updated = await withTransaction(async (conn) => {
    await clientSubscriptionModel.findByClientForUpdate(conn, clientId);
    const usage = await employeeSeatService.getEmployeeSeatUsage(clientId, conn);
    if (!usage.hasCapacity) {
      throw httpError(
        `Employee limit reached (${usage.usedSeats}/${usage.employeeLimit} seats used). Deactivate another employee or upgrade your plan before reactivating.`,
        409,
        "EMPLOYEE_LIMIT_REACHED"
      );
    }
    return userModel.reactivateForClient(conn, clientId, id);
  });
  if (!updated) throw httpError("This account is not currently deactivated.", 409, "ACCOUNT_STATE_CHANGED");
  return serialize(updated);
}

module.exports = { list, invite, cancelInvitation, setStatus, serialize };
