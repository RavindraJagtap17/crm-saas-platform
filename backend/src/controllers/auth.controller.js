const authService = require("../services/authService");
const userModel = require("../models/userModel");
const { verifyGoogleIdToken } = require("../integrations/google/verifyIdToken");
const { getRefreshExpiryMs } = require("../utils/refreshToken");
const asyncHandler = require("../utils/asyncHandler");
const config = require("../config");

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

// POST /api/auth/signup — "Create your agency": only valid for a brand-new email.
const signupAgency = asyncHandler(async (req, res) => {
  const profile = await verifyGoogleIdToken(req.body?.idToken);
  const { accessToken, rawRefreshToken, user } = await authService.signUpAgency(profile, req.body?.agencyName);
  setRefreshCookie(res, rawRefreshToken);
  res.status(201).json({ accessToken, user });
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

// GET /api/auth/me — the authenticated user's own safe profile, role, and tenant.
const me = asyncHandler(async (req, res) => {
  const user = await userModel.findById(req.user.sub);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ user: authService.safeUser(user) });
});

module.exports = { googleSignIn, signupAgency, refresh, logout, me };
