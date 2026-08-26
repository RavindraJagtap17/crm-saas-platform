const { OAuth2Client } = require("google-auth-library");
const config = require("../../config");

const client = new OAuth2Client(config.google.clientId);

/**
 * Verifies a Google Identity Services ID token server-side using Google's
 * own library — signature, expiry, issuer, and audience are all checked
 * against Google's public keys before anything in this payload is trusted.
 * Nothing the frontend claims about "who signed in" is used until this
 * resolves successfully.
 *
 * Throws (with a safe, generic message — never Google's internal error
 * detail, and the raw token itself is never logged anywhere) if the token
 * is missing, malformed, expired, meant for a different app, or the
 * associated Google account's email isn't verified.
 */
async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") {
    const err = new Error("Missing Google ID token");
    err.status = 400;
    throw err;
  }

  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: config.google.clientId,
    });
  } catch {
    const err = new Error("Invalid or expired Google token");
    err.status = 401;
    throw err;
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    const err = new Error("Invalid or expired Google token");
    err.status = 401;
    throw err;
  }
  if (!payload.email_verified) {
    const err = new Error("Google account email is not verified");
    err.status = 401;
    throw err;
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || "",
    avatarUrl: payload.picture || null,
  };
}

module.exports = { verifyGoogleIdToken };
