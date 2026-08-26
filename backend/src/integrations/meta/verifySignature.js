const crypto = require("crypto");
const config = require("../../config");

/**
 * Meta signs every webhook POST body with X-Hub-Signature-256: sha256=<hex>,
 * an HMAC-SHA256 of the RAW request body using the app secret. Must be
 * computed over the exact bytes Meta sent — after JSON.parse() the
 * original byte sequence (whitespace, key order) is lost, so the route
 * captures req.rawBody via express.json()'s verify hook specifically for
 * this (see routes/meta.routes.js).
 */
function verifyMetaSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);

  const expected = crypto.createHmac("sha256", config.meta.appSecret).update(rawBody).digest("hex");

  // Constant-time comparison — a naive === leaks timing information an
  // attacker could use to forge a valid signature byte-by-byte.
  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

module.exports = { verifyMetaSignature };
