const crypto = require("crypto");

/**
 * LinkedIn's webhook challenge-response + notification-signing scheme
 * (https://learn.microsoft.com/en-us/linkedin/shared/api-guide/webhook-validation),
 * both keyed by the LinkedIn app's own clientSecret (not per-connection —
 * one LinkedIn Developer app services every Client's connection here,
 * same as one Meta app services every Client's Meta connection).
 */

// challengeResponse = Hex-encoded(HMACSHA256(challengeCode, clientSecret))
// — answered on GET, during initial registration and LinkedIn's ~2-hour
// recurring re-validation. Lowercase hex per the documented example.
function computeChallengeResponse(challengeCode, clientSecret) {
  return crypto.createHmac("sha256", clientSecret).update(challengeCode).digest("hex");
}

/**
 * X-LI-Signature verification for POST notifications. Per LinkedIn's own
 * docs: "Combine the literal string `hmacsha256=` with the raw JSON POST
 * body to build the string-to-sign... The X-LI-Signature header contains
 * only the hex digest" — NOT prefixed with "hmacsha256=" itself (that
 * prefix is only part of the string being hashed, unlike Meta's
 * "sha256=<hex>" header format). Must be computed over the exact raw
 * bytes LinkedIn sent — see linkedinLeadForm.routes.js's rawBody capture,
 * same reasoning as Meta's own verifySignature.js.
 */
function verifyLinkedInSignature(rawBody, signatureHeader, clientSecret) {
  if (!signatureHeader || typeof signatureHeader !== "string") return false;

  const stringToSign = `hmacsha256=${rawBody}`;
  const expected = crypto.createHmac("sha256", clientSecret).update(stringToSign).digest("hex");

  const providedBuf = Buffer.from(signatureHeader, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length === 0 || providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

module.exports = { computeChallengeResponse, verifyLinkedInSignature };
