/**
 * "Agency pays per Client" restructure — one-off grandfathering script.
 *
 * Every Client that existed before this business model shipped has no
 * client_licenses row at all (the table is brand new). Under the new model
 * requireActiveTenant.js locks a Client's workspace the moment it has no
 * active license, so left alone this would instantly lock out every
 * pre-existing Client the moment this ships. Per the agreed grandfathering
 * decision, each such Client instead gets a fresh 1-year license dated from
 * today, exactly as if they'd just paid for it.
 *
 * Idempotent and additive only: a client that already has a client_licenses
 * row (e.g. Test Client A1, seeded by seedDevAuth.js) is left completely
 * untouched — this only INSERTs for clients with zero rows, never UPDATEs.
 * No migration, no schema change — data only, run once manually.
 *
 * Usage: node backend/scripts/backfillClientLicenses.js
 */
const pool = require("../src/config/db");
const clientLicensePriceModel = require("../src/models/clientLicensePriceModel");

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [clients] = await conn.query(
      `SELECT c.id, c.tenant_id, c.name
         FROM clients c
         LEFT JOIN client_licenses cl ON cl.client_id = c.id
        WHERE cl.id IS NULL
        FOR UPDATE`
    );

    if (clients.length === 0) {
      await conn.commit();
      console.log("No clients missing a license row — nothing to backfill.");
      return;
    }

    // Grandfathering must never fail just because Super Admin hasn't priced
    // anything yet — fall back to 0 rather than blocking the backfill.
    const configuredPrice = await clientLicensePriceModel.get();
    const price = configuredPrice ? configuredPrice.price : 0;
    const currency = configuredPrice ? configuredPrice.currency : "INR";

    for (const client of clients) {
      const orderId = `grandfathered_client_${client.id}`;
      const paymentId = `grandfathered_client_${client.id}`;
      // eslint-disable-next-line no-await-in-loop
      await conn.query(
        `INSERT INTO client_licenses
           (tenant_id, client_id, price, currency, status, razorpay_order_id, razorpay_payment_id, current_period_end)
         VALUES (?, ?, ?, ?, 'active', ?, ?, DATE_ADD(NOW(), INTERVAL 1 YEAR))`,
        [client.tenant_id, client.id, price, currency, orderId, paymentId]
      );
    }

    await conn.commit();

    console.log(`Backfilled ${clients.length} client license(s) at price=${price} ${currency}:`);
    clients.forEach((c) => console.log(`  [grandfathered] client_id=${c.id} tenant_id=${c.tenant_id} (${c.name})`));
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("backfillClientLicenses failed:", err);
  process.exitCode = 1;
});
