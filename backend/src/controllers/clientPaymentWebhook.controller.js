const { verifyRazorpaySignature } = require("../integrations/razorpay/verifySignature");
const tenantRazorpayAccountModel = require("../models/tenantRazorpayAccountModel");
const clientPaymentWebhookService = require("../services/clientPaymentWebhookService");
const webhookLogModel = require("../models/webhookLogModel");
const { decrypt } = require("../utils/encryption");
const logger = require("../utils/logger");
const asyncHandler = require("../utils/asyncHandler");

/**
 * POST /api/razorpay/client-webhook — Client payment events (order.paid,
 * payment.captured, payment.failed) for a Client's Order against an
 * Agency's connected Razorpay account. A SEPARATE endpoint, secret model,
 * and file from BOTH the existing platform Agency webhook
 * (razorpayWebhook.routes.js/razorpayWebhookService.js — untouched) and the
 * OAuth app-level Partner webhook (razorpayPartnerWebhook.controller.js —
 * untouched): connected-account payment webhooks use THAT account's own
 * secret (tenant_razorpay_accounts.webhook_secret_encrypted), not the
 * platform's RAZORPAY_WEBHOOK_SECRET and not the OAuth app's
 * RAZORPAY_PARTNER_WEBHOOK_SECRET — reusing either would verify against
 * the wrong key.
 *
 * Chicken-and-egg resolution: every connected-account webhook payload
 * carries a top-level `account_id` (verified sample payloads, Step 8
 * research), but WHICH secret to verify the signature against can only be
 * determined by reading that field — meaning account_id is read from the
 * still-UNVERIFIED body first, used only to look up a CANDIDATE secret,
 * and is trusted as genuine ONLY once the signature computed with that
 * secret actually matches. This is the same trust model Stripe/Razorpay's
 * own multi-tenant webhook architectures use: forging a valid signature
 * for a claimed account_id requires knowing THAT account's real secret,
 * which is exactly what verification proves.
 */
const receiveEvent = asyncHandler(async (req, res) => {
  const accountId = req.body?.account_id;
  if (!accountId) {
    // Nothing to verify against at all — not necessarily malicious (could
    // be a malformed test request), but definitely not a connected-account
    // payment event this app can process. No signature check was even
    // possible, so this is logged but never causes a retry.
    await webhookLogModel.create({
      source: "razorpay_client",
      eventType: req.body?.event || null,
      payload: req.body,
      signatureValid: false,
      processed: false,
      error: "Missing account_id",
    });
    return res.status(200).json({ received: true, outcome: "malformed_event" });
  }

  const account = await tenantRazorpayAccountModel.findByRazorpayAccountIdWithWebhookSecret(accountId);
  if (!account || !account.webhook_secret_encrypted) {
    // Unknown account_id, OR a known account with no webhook secret
    // provisioned yet — either way there is no secret to verify against,
    // so nothing about this payload (including account_id itself) can be
    // trusted. Logged, never processed, never causes a retry (retrying
    // won't fix an unprovisioned secret).
    logger.warn(`Client payment webhook: no webhook secret available for account_id=${accountId}`);
    await webhookLogModel.create({
      source: "razorpay_client",
      eventType: req.body?.event || null,
      payload: req.body,
      signatureValid: false,
      processed: false,
      error: "Unknown account_id or no webhook secret provisioned",
    });
    return res.status(200).json({ received: true, outcome: "unknown_account" });
  }

  const secret = decrypt(account.webhook_secret_encrypted);
  const signatureHeader = req.headers["x-razorpay-signature"];
  const signatureValid = req.rawBody ? verifyRazorpaySignature(req.rawBody, signatureHeader, secret) : false;

  if (!signatureValid) {
    await webhookLogModel.create({
      source: "razorpay_client",
      tenantId: account.tenant_id,
      eventType: req.body?.event || null,
      payload: req.body,
      signatureValid: false,
      processed: false,
      error: "Invalid signature",
    });
    return res.status(403).json({ error: "Invalid signature." });
  }

  // account_id (and therefore account.tenant_id) is now trusted — the
  // signature could only match if this payload was genuinely signed with
  // THIS account's own secret.
  const eventType = req.body.event;
  const result = await clientPaymentWebhookService.processEvent({
    tenantId: account.tenant_id,
    eventType,
    payload: req.body.payload,
  });

  logger.info(`Client payment webhook: ${eventType} for tenant_id=${account.tenant_id} -> ${result.outcome}`);
  res.status(200).json({ received: true, outcome: result.outcome });
});

module.exports = { receiveEvent };
