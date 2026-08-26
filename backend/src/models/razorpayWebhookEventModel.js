const pool = require("../config/db");

// §M: the idempotency guard itself — INSERT IGNORE against the UNIQUE
// razorpay_event_id. Returns the new row's id when this is genuinely the
// first delivery of this event, or null when it's a repeat (Razorpay
// retries a webhook delivery with the SAME event id, not a new one).
async function recordIfNew(conn, { razorpayEventId, eventType, tenantId, payload }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT IGNORE INTO razorpay_webhook_events (razorpay_event_id, event_type, tenant_id, payload)
     VALUES (?, ?, ?, ?)`,
    [razorpayEventId, eventType, tenantId ?? null, payload ? JSON.stringify(payload) : null]
  );
  return result.affectedRows > 0 ? result.insertId : null;
}

async function markResult(conn, id, { processed, error }) {
  const runner = conn || pool;
  await runner.query(`UPDATE razorpay_webhook_events SET processed = ?, error = ? WHERE id = ?`, [!!processed, error ?? null, id]);
}

module.exports = { recordIfNew, markResult };
