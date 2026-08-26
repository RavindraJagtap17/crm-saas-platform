const crypto = require("crypto");
const config = require("../../config");

/**
 * Razorpay signs every webhook POST body with X-Razorpay-Signature: an
 * HMAC-SHA256 hex digest of the RAW request body using the webhook secret
 * configured in the Razorpay Dashboard (RAZORPAY_WEBHOOK_SECRET — distinct
 * from RAZORPAY_KEY_SECRET). Must be computed over the exact bytes
 * Razorpay sent, before any JSON.parse()/re-stringify — see
 * routes/razorpayWebhook.routes.js for the raw-body capture this depends on
 * (same pattern as Meta's webhook, Step 7).
 */
function verifyRazorpaySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  const expected = crypto.createHmac("sha256", config.razorpay.webhookSecret).update(rawBody).digest("hex");

  const providedBuf = Buffer.from(signatureHeader, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

module.exports = { verifyRazorpaySignature };
