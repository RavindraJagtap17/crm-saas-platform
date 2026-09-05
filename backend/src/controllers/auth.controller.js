const authService = require("../services/authService");
const billingService = require("../services/billingService");
const userModel = require("../models/userModel");
const { verifyGoogleIdToken } = require("../integrations/google/verifyIdToken");
const { getRefreshExpiryMs } = require("../utils/refreshToken");
const asyncHandler = require("../utils/asyncHandler");
const config = require("../config");
const logger = require("../utils/logger");

const REFRESH_COOKIE = "refresh_token";
// Scoped to /api/auth so the browser only ever sends this cookie to the
// auth endpoints that actually need it, not every request to the API.
const REFRESH_COOKIE_PATH = "/api/auth";

function setRefreshCookie(res, rawRefreshToken) {
  res.cookie(REFRESH_COOKIE, rawRefreshToken, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    maxAge: getRefreshExpiryMs(),
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

// POST /api/auth/google — normal sign-in for an account that already exists.
const googleSignIn = asyncHandler(async (req, res) => {
  const profile = await verifyGoogleIdToken(req.body?.idToken);
  const { accessToken, rawRefreshToken, user } = await authService.signInWithGoogle(profile);
  setRefreshCookie(res, rawRefreshToken);
  res.json({ accessToken, user });
});

// POST /api/auth/signup — self-service Agency signup (new business model:
// "Agency signup is self-service... Super Admin does not manually create
// the Agency or first Agency Admin" — supersedes the earlier hard-410
// refusal this route used to return). Mirrors googleSignIn's own pattern
// of verifying the ID token here in the controller before handing a
// trusted profile to the service layer.
//
// Two separate steps, deliberately not one atomic operation:
// authService.signUpAgency creates the tenant + Agency Admin + session
// (all local, no external call — fully succeeds or fully rolls back).
// billingService.initiateAgencySubscription then creates the Razorpay
// Customer + Subscription against the platform's existing account. If
// that second step fails (e.g. Razorpay unreachable, or Super Admin
// hasn't configured the Agency plan yet), the signup itself has already
// succeeded — the account and session are real — so the failure is
// surfaced as checkout: null rather than failing the whole request; the
// new Agency Admin can retry via POST /api/billing/agency-subscription
// (§ "User must be able to retry payment").
const signupAgency = asyncHandler(async (req, res) => {
  const profile = await verifyGoogleIdToken(req.body?.idToken);
  const { accessToken, rawRefreshToken, user } = await authService.signUpAgency(profile, req.body);
  setRefreshCookie(res, rawRefreshToken);

  let checkout = null;
  try {
    const result = await billingService.initiateAgencySubscription(user.tenantId, user);
    checkout = result.checkout;
  } catch (err) {
    logger.warn(`Agency signup: could not initiate subscription for tenant_id=${user.tenantId}: ${err.message}`);
  }

  res.status(201).json({ accessToken, user, checkout });
});

// POST /api/auth/refresh — rotates the refresh token and issues a new access token.
const refresh = asyncHandler(async (req, res) => {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE];
  const { accessToken, rawRefreshToken: newRaw, user } = await authService.refreshSession(rawRefreshToken);
  setRefreshCookie(res, newRaw);
  res.json({ accessToken, user });
});

// POST /api/auth/logout — revokes the current refresh token.
const logout = asyncHandler(async (req, res) => {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE];
  await authService.revokeSession(rawRefreshToken);
  clearRefreshCookie(res);
  res.status(204).send();
});

const DEV_LOGIN_EMAILS = {
  super_admin: "dev-superadmin@local.test",
  agency_admin_test101: "dev-agencyadmin-test101@local.test",
  client_admin_test101: "dev-clientadmin-test101@local.test",
  client_employee_test101: "dev-clientemployee-test101@local.test",
};

// POST /api/auth/dev-login — C16: development-only, NODE_ENV-gated at
// ROUTE REGISTRATION (see auth.routes.js — this handler is never wired up
// at all in production, not just refused at runtime). Reuses
// authService.issueSession() verbatim — the exact same token/cookie/
// rotation path real Google Sign-In uses — so a dev session is
// indistinguishable from a real one to every other part of the app. The
// Google Sign-In code path itself is completely untouched by this.
const devLogin = asyncHandler(async (req, res) => {
  const email = DEV_LOGIN_EMAILS[req.body?.role];
  if (!email) {
    return res.status(400).json({
      error: `role must be one of: ${Object.keys(DEV_LOGIN_EMAILS).join(", ")}.`,
    });
  }

  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.status(404).json({
      error: `Dev user for role "${req.body.role}" not found. Run: node backend/scripts/seedDevAuth.js`,
    });
  }

  const { accessToken, rawRefreshToken, user: safeUser } = await authService.issueSession(user);
  setRefreshCookie(res, rawRefreshToken);
  res.json({ accessToken, user: safeUser });
});

// GET /api/auth/me — the authenticated user's own safe profile, role, and tenant.
const me = asyncHandler(async (req, res) => {
  const user = await userModel.findById(req.user.sub);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ user: authService.safeUser(user) });
});

module.exports = { googleSignIn, signupAgency, refresh, logout, me, devLogin };
