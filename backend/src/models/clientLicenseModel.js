const pool = require("../config/db");

// "Agency pays per Client" restructure (client_licenses, migration 054) —
// one row per Client (uq_client_licenses_client), updated in place across
// its lifecycle exactly like clientSubscriptionModel's own "one row per
// client" shape, but simpler: no plan_id (one global price, see
// clientLicensePriceModel), no upgrade/downgrade, no grace period.
const COLUMNS = `
  id, tenant_id, client_id, price, currency, status,
  razorpay_order_id, razorpay_payment_id, current_period_end,
  created_at, updated_at
`;

async function findByClient(clientId, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM client_licenses WHERE client_id = ? LIMIT 1`, [clientId]);
  return rows[0] || null;
}

async function findByOrderId(orderId, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM client_licenses WHERE razorpay_order_id = ? LIMIT 1`, [orderId]);
  return rows[0] || null;
}

// One row per client — a fresh client gets an INSERT; a renewal (or a
// retried initial purchase) overwrites the existing row with a new
// pending Order, clearing razorpay_payment_id (the OLD payment no longer
// corresponds to the CURRENT outstanding order) and leaving
// current_period_end untouched until confirmPayment actually confirms it
// (so an in-progress renewal never prematurely looks like it already
// extended access).
async function upsertPending(conn, { tenantId, clientId, price, currency, razorpayOrderId }) {
  const runner = conn || pool;
  const existing = await findByClient(clientId, runner);
  if (!existing) {
    const [result] = await runner.query(
      `INSERT INTO client_licenses (tenant_id, client_id, price, currency, status, razorpay_order_id)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [tenantId, clientId, price, currency, razorpayOrderId]
    );
    return findByClient(clientId, runner).then((r) => r || { id: result.insertId });
  }
  await runner.query(
    `UPDATE client_licenses SET
       price = ?, currency = ?, status = 'pending',
       razorpay_order_id = ?, razorpay_payment_id = NULL
     WHERE id = ?`,
    [price, currency, razorpayOrderId, existing.id]
  );
  return findByClient(clientId, runner);
}

async function markActive(conn, id, { razorpayPaymentId, currentPeriodEnd }) {
  const runner = conn || pool;
  await runner.query(
    `UPDATE client_licenses SET status = 'active', razorpay_payment_id = ?, current_period_end = ? WHERE id = ?`,
    [razorpayPaymentId, currentPeriodEnd, id]
  );
}

// Super Admin surface: batch lookup for the Agency detail page's client
// table (one query for every client on the page, instead of N+1). Plain
// IN(...) — client_licenses has no tenant scoping of its own to add here;
// the CALLER (superAdminService.getTenant) already only ever passes client
// ids it just read for one specific tenant.
async function listByClientIds(clientIds) {
  if (!clientIds.length) return [];
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM client_licenses WHERE client_id IN (?)`, [clientIds]);
  return rows;
}

// Super Admin platform dashboard (§6): every Client's license bucket in
// one query, LEFT JOINed so a Client with NO client_licenses row at all
// still appears (as a row with status/current_period_end both NULL) —
// clientLicenseService.normalizedStatus treats that the same as a
// genuinely 'pending' license (never purchased == not yet paid for).
async function listAllForDashboard() {
  const [rows] = await pool.query(
    `SELECT c.id AS client_id, cl.status, cl.current_period_end
     FROM clients c
     LEFT JOIN client_licenses cl ON cl.client_id = c.id`
  );
  return rows;
}

module.exports = { findByClient, findByOrderId, upsertPending, markActive, listByClientIds, listAllForDashboard };
