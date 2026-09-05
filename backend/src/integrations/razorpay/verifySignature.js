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
// `secret` is optional and trailing, defaulting to the existing platform
// webhook secret — every existing call site (razorpayWebhook.controller.js)
// is unaffected. Added so razorpayPartnerWebhook.controller.js can verify
// against RAZORPAY_PARTNER_WEBHOOK_SECRET instead (a genuinely different
// secret — see that file's comment), without duplicating this HMAC logic.
function verifyRazorpaySignature(rawBody, signatureHeader, secret = config.razorpay.webhookSecret) {
  if (!signatureHeader) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const providedBuf = Buffer.from(signatureHeader, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

module.exports = { verifyRazorpaySignature };
