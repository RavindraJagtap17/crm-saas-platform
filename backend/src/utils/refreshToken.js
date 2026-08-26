const crypto = require("crypto");
const config = require("../config");

const DEFAULT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

function parseDurationMs(input) {
  const match = /^(\d+)\s*([smhd])$/i.exec(String(input).trim());
  if (!match) return DEFAULT_MS;
  return parseInt(match[1], 10) * UNIT_MS[match[2].toLowerCase()];
}

// Raw refresh tokens are random, opaque, 384-bit values — not JWTs. There is
// nothing for a client to decode or verify; it's just a bearer secret the
// server can look up. This is what makes real revocation possible, which a
// self-contained signed JWT refresh token could not offer without a
// separate blacklist anyway.
function generateRawToken() {
  return crypto.randomBytes(48).toString("hex");
}

// The raw token is never written to the database — only this HMAC of it,
// so a database leak alone can't be used to forge or replay a session.
// JWT_REFRESH_SECRET doubles as the HMAC key here rather than signing a
// token, per the approved environment variable list.
function hashToken(rawToken) {
  return crypto.createHmac("sha256", config.jwt.refreshSecret).update(rawToken).digest("hex");
}

function getRefreshExpiryMs() {
  return parseDurationMs(config.jwt.refreshExpiry);
}

module.exports = { generateRawToken, hashToken, getRefreshExpiryMs };
