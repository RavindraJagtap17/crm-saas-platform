const razorpayWebhookEventModel = require("../models/razorpayWebhookEventModel");
const clientLicenseService = require("./clientLicenseService");
const withTransaction = require("../utils/withTransaction");

/**
 * "Agency pays per Client" restructure — this file used to reconcile TWO
 * different kinds of Agency-level Razorpay Subscription objects (the
 * Step-9 local plan catalog, and the flat single-Agency-plan model that
 * later superseded it) plus their payment ledger. Both systems, and every
 * Agency-level Subscription concept along with them, are gone: Agency
 * signup is free now, so there is no Agency-level `subscription.*` event
 * this webhook needs to reconcile at all any more. The ONLY thing left on
 * the platform's own Razorpay webhook is confirming a Client License
 * payment — a one-off Order, not a recurring Subscription, so it arrives
 * as `order.paid`/`payment.captured`, not any `subscription.*` event.
 */
async function dispatch(conn, eventType, payload) {
  // Both order.paid and payment.captured carry a payment entity (see
  // clientLicenseService.confirmPayment's own comment on why both are
  // listened for) — passing `conn` through keeps this activation inside
  // the SAME outer transaction processEvent already opened. This is the
  // platform's own webhook (RAZORPAY_WEBHOOK_SECRET) — a Client License is
  // always paid through the platform's own account, never a connected one.
  if (eventType === "order.paid" || eventType === "payment.captured") {
    const paymentEntity = payload?.payment?.entity;
    if (!paymentEntity?.id) return { outcome: "malformed_event", tenantId: null };
    const result = await clientLicenseService.confirmPayment(paymentEntity, conn);
    return { outcome: result.outcome, tenantId: result.tenantId ?? null };
  }

  // Everything else Razorpay might send (payment.authorized, refund.*,
  // ...) is acknowledged and otherwise ignored — there is no local state
  // this app reconciles from them.
  return { outcome: "ignored_event_type", tenantId: null };
}

/**
 * The full idempotency + reconciliation unit, atomic end to end. The
 * "this event was already handled" marker and every local state change it
 * causes are committed TOGETHER in one transaction. If reconciliation
 * throws partway through, withTransaction rolls back EVERYTHING — including
 * the idempotency insert itself — on purpose: a half-applied event must
 * never be remembered as "seen", or a Razorpay retry of the same event id
 * would be silently skipped instead of correctly reprocessing from
 * scratch. A thrown error here propagates to the controller, which
 * responds non-2xx so Razorpay's own retry mechanism tries again later —
 * deliberately not swallowed into a 200, unlike Meta's per-entry webhook,
 * since Razorpay delivers exactly one event per request rather than a
 * batch of independent ones.
 */
async function processEvent({ razorpayEventId, eventType, payload }) {
  return withTransaction(async (conn) => {
    const eventRowId = await razorpayWebhookEventModel.recordIfNew(conn, {
      razorpayEventId,
      eventType,
      tenantId: null, // filled in below once dispatch() resolves which tenant this event belongs to
      payload,
    });
    if (eventRowId === null) {
      return { outcome: "already_processed" };
    }

    const result = await dispatch(conn, eventType, payload);

    await razorpayWebhookEventModel.markResult(conn, eventRowId, { processed: true, error: null });
    if (result.tenantId) {
      await conn.query(`UPDATE razorpay_webhook_events SET tenant_id = ? WHERE id = ?`, [result.tenantId, eventRowId]);
    }
    return result;
  });
}

module.exports = { processEvent };
