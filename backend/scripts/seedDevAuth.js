/**
 * Phase C / C16: seeds a clean, clearly-marked, local-only test hierarchy
 * for POST /api/auth/dev-login — one account per role, already active (no
 * Google Sign-In round trip needed for local development). Idempotent:
 * safe to run repeatedly, only ever creates what's missing.
 *
 * Extended (dev/test subscription fixtures): also ensures Test Agency 101
 * has a genuinely ACTIVE agency_subscriptions row and Test Client A1 has a
 * genuinely ACTIVE client_subscriptions row — real rows in the SAME tables
 * requireActiveTenant.js / clientService.effectiveClientLimit() /
 * clientBillingService.js read for every other tenant/client, so the
 * normal subscription-gating logic sees these dev accounts as truly
 * subscribed rather than the frontend/tests special-casing them. No
 * business logic, middleware, or migration is touched to make this true —
 * only data, inserted the same direct-SQL way this script already inserts
 * the dev tenant/client/users above.
 *
 * NEVER run against a production database — dev-login itself is already
 * NODE_ENV-gated (see auth.routes.js), but this seeder has no such gate of
 * its own and is meant to be run manually, by a developer, against a local
 * dev database only.
 *
 * Usage: node backend/scripts/seedDevAuth.js
 */
const pool = require("../src/config/db");

const DEV_AGENCY_NAME = "Test Agency 101";
const DEV_CLIENT_NAME = "Test Client A1";

// Dev-only, clearly-marked placeholders — never real Razorpay ids, and
// distinct per fixture row so the UNIQUE constraints on
// agency_subscriptions.razorpay_subscription_id / client_subscriptions.
// razorpay_subscription_id can never collide with a genuine one.
const DEV_AGENCY_PLAN_RAZORPAY_ID = "plan_dev_seed_agency_101";
const DEV_AGENCY_SUBSCRIPTION_RAZORPAY_ID = "sub_dev_seed_agency_101";
const DEV_AGENCY_CUSTOMER_RAZORPAY_ID = "cust_dev_seed_agency_101";
const DEV_CLIENT_PLAN_NAME = "Dev Seed Plan (Test Client A1)";
const DEV_CLIENT_SUBSCRIPTION_RAZORPAY_ID = "sub_dev_seed_client_a1";
const DEV_CLIENT_CUSTOMER_RAZORPAY_ID = "cust_dev_seed_client_a1";

const DEV_USERS = [
  { email: "dev-superadmin@local.test", name: "Dev Super Admin", role: "super_admin", testKey: "super_admin" },
  { email: "dev-agencyadmin-test101@local.test", name: "Dev Agency Admin — Test Agency 101", role: "agency_admin", testKey: "agency_admin_test101" },
  { email: "dev-clientadmin-test101@local.test", name: "Dev Client Admin — Test Client A1", role: "client_admin", testKey: "client_admin_test101" },
  { email: "dev-clientemployee-test101@local.test", name: "Dev Client Employee — Test Client A1", role: "client_employee", testKey: "client_employee_test101" },
];

async function findOrCreateTenant(conn) {
  const [rows] = await conn.query("SELECT id FROM tenants WHERE name = ? LIMIT 1", [DEV_AGENCY_NAME]);
  if (rows[0]) return rows[0].id;
  const [result] = await conn.query(
    `INSERT INTO tenants (name, slug, status) VALUES (?, 'dev-agency-seeded', 'active')`,
    [DEV_AGENCY_NAME]
  );
  return result.insertId;
}

async function findOrCreateClient(conn, tenantId) {
  const [rows] = await conn.query("SELECT id FROM clients WHERE tenant_id = ? AND name = ? LIMIT 1", [tenantId, DEV_CLIENT_NAME]);
  if (rows[0]) return rows[0].id;
  const [result] = await conn.query(
    `INSERT INTO clients (tenant_id, name, status) VALUES (?, ?, 'active')`,
    [tenantId, DEV_CLIENT_NAME]
  );
  return result.insertId;
}

// The ONE global Agency plan (singleton, migration 041) — find-or-create
// only, NEVER overwritten if it already exists (a developer may already
// have configured a real price via Super Admin's own Agency Plan page;
// this must never clobber that).
async function findOrCreateAgencyPlan(conn) {
  const [rows] = await conn.query("SELECT id FROM agency_subscription_plan WHERE singleton_guard = 1 LIMIT 1");
  if (rows[0]) return { id: rows[0].id, created: false };
  const [result] = await conn.query(
    `INSERT INTO agency_subscription_plan (singleton_guard, price, currency, billing_cycle, razorpay_plan_id, is_active)
     VALUES (1, 999900, 'INR', 'yearly', ?, TRUE)`,
    [DEV_AGENCY_PLAN_RAZORPAY_ID]
  );
  return { id: result.insertId, created: true };
}

// Test Agency 101's own agency_subscriptions row (migration 042) — unlike
// the plan above, this one IS repaired to 'active' on every run: the
// whole point of this fixture is "Test Agency 101 must have an ACTIVE
// Agency subscription" as an invariant, not just "has some row". A real
// current_period_end a year out and auto_renew=true make it read exactly
// like a genuinely active subscription to every consumer (requireActiveTenant,
// the Agency Billing page, Super Admin's per-Agency view) — no code path
// anywhere treats this row differently because it came from a seed script.
async function ensureActiveAgencySubscription(conn, tenantId, planId) {
  const [rows] = await conn.query("SELECT id, status FROM agency_subscriptions WHERE tenant_id = ? LIMIT 1", [tenantId]);
  if (rows[0]) {
    if (rows[0].status === "active") return { id: rows[0].id, created: false, repaired: false };
    await conn.query(
      `UPDATE agency_subscriptions
         SET status = 'active', plan_id = ?, current_period_end = DATE_ADD(NOW(), INTERVAL 1 YEAR),
             grace_period_ends_at = NULL, auto_renew = TRUE
       WHERE id = ?`,
      [planId, rows[0].id]
    );
    return { id: rows[0].id, created: false, repaired: true };
  }
  const [result] = await conn.query(
    `INSERT INTO agency_subscriptions
       (tenant_id, plan_id, razorpay_subscription_id, razorpay_customer_id, status, current_period_end, auto_renew)
     VALUES (?, ?, ?, ?, 'active', DATE_ADD(NOW(), INTERVAL 1 YEAR), TRUE)`,
    [tenantId, planId, DEV_AGENCY_SUBSCRIPTION_RAZORPAY_ID, DEV_AGENCY_CUSTOMER_RAZORPAY_ID]
  );
  return { id: result.insertId, created: true, repaired: false };
}

// Test Client A1's own Agency-scoped plan (migration 043) — find-or-create,
// scoped to this tenant only, so it can never collide with or affect any
// other agency's real client-plan catalog.
async function findOrCreateClientPlan(conn, tenantId) {
  const [rows] = await conn.query("SELECT id, price FROM client_subscription_plans WHERE tenant_id = ? AND name = ? LIMIT 1", [
    tenantId,
    DEV_CLIENT_PLAN_NAME,
  ]);
  if (rows[0]) return { id: rows[0].id, price: rows[0].price, created: false };
  const price = 49900;
  const [result] = await conn.query(
    `INSERT INTO client_subscription_plans (tenant_id, name, price, currency, billing_cycle, max_active_employees, is_active)
     VALUES (?, ?, ?, 'INR', 'monthly', 10, TRUE)`,
    [tenantId, DEV_CLIENT_PLAN_NAME, price]
  );
  return { id: result.insertId, price, created: true };
}

// Test Client A1's own client_subscriptions row (migration 044) — same
// "repair to active on every run" invariant as the Agency subscription
// above, for the same reason: "Test Client A1 must have an ACTIVE Client
// subscription" must hold every time this script runs, not just the first.
async function ensureActiveClientSubscription(conn, tenantId, clientId, plan) {
  const [rows] = await conn.query("SELECT id, status FROM client_subscriptions WHERE client_id = ? LIMIT 1", [clientId]);
  if (rows[0]) {
    if (rows[0].status === "active") return { id: rows[0].id, created: false, repaired: false };
    await conn.query(
      `UPDATE client_subscriptions
         SET status = 'active', plan_id = ?, current_price = ?,
             current_period_start = NOW(), current_period_end = DATE_ADD(NOW(), INTERVAL 1 MONTH),
             grace_period_ends_at = NULL, auto_renew = TRUE,
             next_plan_id = NULL, pending_razorpay_order_id = NULL, pending_upgrade_plan_id = NULL
       WHERE id = ?`,
      [plan.id, plan.price, rows[0].id]
    );
    return { id: rows[0].id, created: false, repaired: true };
  }
  const [result] = await conn.query(
    `INSERT INTO client_subscriptions
       (tenant_id, client_id, plan_id, razorpay_subscription_id, razorpay_customer_id, status,
        current_period_start, current_period_end, current_price, auto_renew)
     VALUES (?, ?, ?, ?, ?, 'active', NOW(), DATE_ADD(NOW(), INTERVAL 1 MONTH), ?, TRUE)`,
    [tenantId, clientId, plan.id, DEV_CLIENT_SUBSCRIPTION_RAZORPAY_ID, DEV_CLIENT_CUSTOMER_RAZORPAY_ID, plan.price]
  );
  return { id: result.insertId, created: true, repaired: false };
}

async function roleId(conn, name) {
  const [rows] = await conn.query("SELECT id FROM roles WHERE name = ? LIMIT 1", [name]);
  if (!rows[0]) throw new Error(`Role "${name}" not found — run migrations first (see migrations/027_add_new_roles.up.sql).`);
  return rows[0].id;
}

async function findOrCreateUser(conn, { email, name, role }, { tenantId, clientId }) {
  const [existing] = await conn.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing[0]) return { id: existing[0].id, created: false };

  const rid = await roleId(conn, role);
  const [result] = await conn.query(
    `INSERT INTO users (tenant_id, client_id, email, name, role_id, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [tenantId ?? null, clientId ?? null, email, name, rid]
  );
  return { id: result.insertId, created: true };
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const tenantId = await findOrCreateTenant(conn);
    const clientId = await findOrCreateClient(conn, tenantId);

    const agencyPlan = await findOrCreateAgencyPlan(conn);
    const agencySubscription = await ensureActiveAgencySubscription(conn, tenantId, agencyPlan.id);
    const clientPlan = await findOrCreateClientPlan(conn, tenantId);
    const clientSubscription = await ensureActiveClientSubscription(conn, tenantId, clientId, clientPlan);

    const scopeFor = {
      super_admin: { tenantId: null, clientId: null },
      agency_admin: { tenantId, clientId: null },
      client_admin: { tenantId: null, clientId },
      client_employee: { tenantId: null, clientId },
    };

    const results = [];
    for (const u of DEV_USERS) {
      // eslint-disable-next-line no-await-in-loop
      const r = await findOrCreateUser(conn, u, scopeFor[u.role]);
      results.push({ ...u, ...r });
    }

    await conn.commit();

    console.log(`Dev agency: ${DEV_AGENCY_NAME} (id=${tenantId})`);
    console.log(`Dev client: ${DEV_CLIENT_NAME} (id=${clientId})`);
    results.forEach((r) => {
      console.log(`  [${r.created ? "created" : "exists "}] ${r.testKey.padEnd(24)} ${r.email} (user id=${r.id})`);
    });

    const subState = (r) => (r.created ? "created active" : r.repaired ? "repaired to active" : "already active");
    console.log(`\nAgency subscription (agency_subscriptions, tenant_id=${tenantId}): [${subState(agencySubscription)}] id=${agencySubscription.id}`);
    console.log(`Agency plan (agency_subscription_plan singleton): [${agencyPlan.created ? "created" : "exists"}] id=${agencyPlan.id}`);
    console.log(`Client subscription (client_subscriptions, client_id=${clientId}): [${subState(clientSubscription)}] id=${clientSubscription.id}`);
    console.log(`Client plan (client_subscription_plans, tenant_id=${tenantId}): [${clientPlan.created ? "created" : "exists"}] id=${clientPlan.id}`);

    console.log("\nUse POST /api/auth/dev-login with { \"role\": \"<testKey>\" } to sign in as any of these (development only).");
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("seedDevAuth failed:", err);
  process.exitCode = 1;
});
