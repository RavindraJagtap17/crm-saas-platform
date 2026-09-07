const userModel = require("../models/userModel");
const roleModel = require("../models/roleModel");
const employeeInvitationModel = require("../models/employeeInvitationModel");
const withTransaction = require("../utils/withTransaction");
const httpError = require("../utils/httpError");
const { validateInvite, validateStatusChange } = require("../validators/userValidators");

// B2B2C restructure: this service is CLIENT-scoped — a Client Admin
// managing their own client's team (client_employee only; a co-Client-Admin
// is not something a Client Admin can create — that's the Agency Admin's
// job one level up, see clientService.inviteClientAdmin, untouched by
// this step).
//
// "Agency pays per Client" restructure: employee count is no longer
// limited at all (it used to be capped by client_subscriptions.plan_id ->
// client_subscription_plans.max_active_employees — that whole system is
// gone). A Client Admin can invite/reactivate as many client_employee
// accounts as they want; there is nothing left to check capacity against.
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
  const [users, invitations] = await Promise.all([
    userModel.listByClient(clientId),
    employeeInvitationModel.listPendingForClient(clientId),
  ]);
  return {
    users: users.map(serialize),
    invitations: invitations.map(serializeInvitation),
  };
}

/**
 * Creates a pending employee_invitations row AND the existing
 * users(status='invited') row (unchanged, so Google-Sign-In activation
 * keeps working exactly as before), atomically — no capacity check or row
 * lock any more (see this file's own header comment).
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
 * Step 11A — Client Admin cancels a still-pending invitation: deletes the
 * corresponding never-activated users row so the email is free to be
 * re-invited (users.email is globally UNIQUE; see userModel.
 * deleteInvitedByClientAndEmail's own comment). Client-scoped
 * (findByIdForClient-equivalent guard is built into employeeInvitationModel.
 * cancel's own WHERE clause) — a cross-Client id, or one that's already
 * accepted/cancelled/expired, simply matches no row.
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
 * Step 11A — deactivate/reactivate, still with the protections the
 * business rules require: never a client_admin (self or otherwise — this
 * router is client_admin-only to begin with, so "self" and "another
 * client_admin" are the same guard), never an 'invited' row (that has no
 * meaning here — cancel the invitation instead; also prevents a stale
 * employee_invitations row from silently going out of sync with a users
 * row this endpoint touched directly). No capacity check on reactivation
 * any more (see this file's own header comment).
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

  const updated = await userModel.reactivateForClient(null, clientId, id);
  if (!updated) throw httpError("This account is not currently deactivated.", 409, "ACCOUNT_STATE_CHANGED");
  return serialize(updated);
}

module.exports = { list, invite, cancelInvitation, setStatus, serialize };
