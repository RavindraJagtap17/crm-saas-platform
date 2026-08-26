const pool = require("../config/db");
const userModel = require("../models/userModel");
const tenantModel = require("../models/tenantModel");
const roleModel = require("../models/roleModel");
const refreshTokenModel = require("../models/refreshTokenModel");
const { signAccessToken } = require("../utils/jwt");
const { generateRawToken, hashToken, getRefreshExpiryMs } = require("../utils/refreshToken");

function httpError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

// What's safe to ever send back to a client or put in an API response —
// no internal ids beyond the user's own, no google_id.
function safeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    role: user.role_name,
    tenantId: user.tenant_id,
    status: user.status,
    // Step 9: UX-only signal for the frontend (e.g. redirect a
    // pending_payment tenant_admin to billing.html) — null for a
    // super_admin, who carries no tenant at all. The actual access gate
    // is enforced server-side by requireActiveTenant, not this field.
    tenantStatus: user.tenant_status ?? null,
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
      "No account found for this email. Ask your admin to invite you, or create a new agency to get started.",
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
  await userModel.markLogin(existing.id, { googleId: googleProfile.googleId });
  const updated = await userModel.findById(existing.id);
  return issueSession(updated);
}

/**
 * "Create your agency" self-service flow: only valid for an email with no
 * existing account. Creates the tenant and its first Tenant Admin in one
 * transaction — either both exist afterward, or neither does.
 */
async function signUpAgency(googleProfile, agencyName) {
  const trimmedName = String(agencyName || "").trim();
  if (!trimmedName) {
    throw httpError("Agency name is required.", 400, "AGENCY_NAME_REQUIRED");
  }

  const existing = await userModel.findByEmail(googleProfile.email);
  if (existing) {
    throw httpError("An account already exists for this email. Sign in instead.", 409, "ACCOUNT_EXISTS");
  }

  const tenantAdminRole = await roleModel.findByName("tenant_admin");
  if (!tenantAdminRole) {
    // Only possible if the Step 2 seeder was never run — a setup problem,
    // not a user-facing one.
    throw httpError("Server is not set up correctly (tenant_admin role missing).", 500);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const slug = await tenantModel.generateUniqueSlug(conn, trimmedName);
    const tenantId = await tenantModel.createTenant(conn, { name: trimmedName, slug });
    await userModel.createTenantAdmin(conn, {
      tenantId,
      roleId: tenantAdminRole.id,
      googleId: googleProfile.googleId,
      email: googleProfile.email,
      name: googleProfile.name,
      avatarUrl: googleProfile.avatarUrl,
    });

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const user = await userModel.findByEmail(googleProfile.email);
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

module.exports = { signInWithGoogle, signUpAgency, refreshSession, revokeSession, safeUser };
