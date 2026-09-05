const userModel = require("../models/userModel");
const refreshTokenModel = require("../models/refreshTokenModel");
const tenantModel = require("../models/tenantModel");
const roleModel = require("../models/roleModel");
const employeeInvitationModel = require("../models/employeeInvitationModel");
const pool = require("../config/db");
const { signAccessToken } = require("../utils/jwt");
const { generateRawToken, hashToken, getRefreshExpiryMs } = require("../utils/refreshToken");
const { validateSignupAgency } = require("../validators/agencySubscriptionValidators");

function httpError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

// What's safe to ever send back to a client or put in an API response —
// no internal ids beyond the user's own, no google_id.
//
// tenantId is the resolved AGENCY id (userModel.SELECT_WITH_ROLE's
// effective_tenant_id) — for a client-level user this comes via
// clients.tenant_id, never their own always-NULL users.tenant_id.
// tenantStatus/clientStatus are UX-only signals for the frontend (e.g.
// redirect a pending_payment agency_admin to billing, or show a
// deactivated-client banner) — the actual access gate is enforced
// server-side by requireActiveTenant, never these fields alone.
function safeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    role: user.role_name,
    tenantId: user.effective_tenant_id ?? user.tenant_id ?? null,
    clientId: user.client_id ?? null,
    status: user.status,
    tenantStatus: user.effective_tenant_status ?? null,
    clientStatus: user.client_status ?? null,
  };
}

async function issueSession(user) {
  const accessToken = signAccessToken(user);
  const rawRefreshToken = generateRawToken();
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + getRefreshExpiryMs());

  await refreshTokenModel.create({ userId: user.id, tokenHash, expiresAt });

  return { accessToken, rawRefreshToken, user: safeUser(user) };
}

/**
 * Normal Google Sign-In: the account must already exist.
 * - Unknown email -> rejected (not auto-created here; see signUpAgency).
 * - Deactivated account -> rejected.
 * - Invited account -> activated as part of this same successful sign-in.
 * - Active account -> just logs in.
 */
async function signInWithGoogle(googleProfile) {
  const existing = await userModel.findByEmail(googleProfile.email);

  if (!existing) {
    throw httpError(
      "No account found for this email. Ask your platform or agency administrator to invite you.",
      404,
      "ACCOUNT_NOT_FOUND"
    );
  }

  if (existing.status === "deactivated") {
    throw httpError("This account has been deactivated.", 403, "ACCOUNT_DEACTIVATED");
  }

  // Covers both "existing active user" and "invited user activating" —
  // markLogin only flips invited -> active, an already-active row is
  // left as-is.
  const wasInvited = existing.status === "invited";
  await userModel.markLogin(existing.id, { googleId: googleProfile.googleId });

  // Step 11A — this activation is exactly "Accepted invitation: becomes
  // an active employee" (Confirmed Business Rules): the matching PENDING
  // employee_invitations row (if any — client_admin invites never create
  // one, see userService.js) moves seat accounting from pending to
  // active by marking it 'accepted'. A safe no-op when no such row
  // exists. Only checked for a client-scoped user (client_id set) since
  // only client_employee invites ever go through employee_invitations.
  if (wasInvited && existing.client_id) {
    await employeeInvitationModel.markAcceptedByEmail(existing.client_id, existing.email, existing.id);
  }

  const updated = await userModel.findById(existing.id);
  return issueSession(updated);
}

/**
 * Self-service Agency signup — supersedes the earlier "Business Decision
 * 4" hard-410 refusal (Super-Admin-only agency creation). Current
 * approved business model: "Agency signup is self-service... the person
 * completing signup becomes the Agency Admin... Super Admin does not
 * manually create the Agency or first Agency Admin." superAdminService's
 * createAgency/inviteAgencyAdmin path is left completely unchanged and
 * still exists — it's just no longer the only way an agency comes into
 * being.
 *
 * `googleProfile` is already-verified (caller resolves it via
 * verifyGoogleIdToken exactly like signInWithGoogle's caller does — this
 * function never sees a raw ID token). Creates ONLY the tenant and its
 * first Agency Admin here, both in one local transaction with no external
 * API call — Razorpay subscription creation is a deliberately separate
 * step (billingService.initiateAgencySubscription, called right after
 * this by auth.controller.js) so a Razorpay-side failure can never leave
 * a half-created account: by the time this function returns, the tenant,
 * its admin, and their session all either fully exist or don't exist at
 * all.
 *
 * Unlike every other account-creation path in this file, the resulting
 * user starts 'active' with google_id already linked (userModel.
 * createActiveAgencyAdmin) — the person has already proven their identity
 * via the same verified Google ID token used for ordinary sign-in, so
 * there is no separate invited -> activate step to go through.
 */
async function signUpAgency(googleProfile, body) {
  const { name } = validateSignupAgency(body);

  const existingUser = await userModel.findByEmail(googleProfile.email);
  if (existingUser) {
    throw httpError("An account already exists for this email. Sign in instead.", 409, "ACCOUNT_EXISTS");
  }

  const role = await roleModel.findByName("agency_admin");

  const conn = await pool.getConnection();
  let user;
  try {
    await conn.beginTransaction();
    const slug = await tenantModel.generateUniqueSlug(conn, name);
    const tenantId = await tenantModel.createTenant(conn, { name, slug });
    user = await userModel.createActiveAgencyAdmin(conn, tenantId, {
      email: googleProfile.email,
      name: googleProfile.name || name,
      googleId: googleProfile.googleId,
      avatarUrl: googleProfile.avatarUrl,
      roleId: role.id,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return issueSession(user);
}

/**
 * Rotates a refresh token: the presented one is always consumed (revoked)
 * on a successful call, and a fresh access + refresh pair is issued.
 * Presenting a token that was already rotated out is treated as possible
 * theft and revokes every session the user has.
 */
async function refreshSession(rawRefreshToken) {
  if (!rawRefreshToken) {
    throw httpError("Missing refresh token", 401);
  }

  const tokenHash = hashToken(rawRefreshToken);
  const record = await refreshTokenModel.findByHash(tokenHash);

  if (!record) {
    throw httpError("Invalid refresh token", 401);
  }

  if (record.revoked_at) {
    await refreshTokenModel.revokeAllForUser(record.user_id);
    throw httpError("Refresh token has already been used. All sessions for this account were revoked.", 401);
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw httpError("Refresh token expired", 401);
  }

  await refreshTokenModel.revoke(record.id);

  const user = await userModel.findById(record.user_id);
  if (!user || user.status === "deactivated") {
    throw httpError("Account is no longer active", 403);
  }

  return issueSession(user);
}

async function revokeSession(rawRefreshToken) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  const record = await refreshTokenModel.findByHash(tokenHash);
  if (record) await refreshTokenModel.revoke(record.id);
}

module.exports = { signInWithGoogle, signUpAgency, refreshSession, revokeSession, safeUser, issueSession };
