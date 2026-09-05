/**
 * Phase C / C16: seeds a clean, clearly-marked, local-only test hierarchy
 * for POST /api/auth/dev-login — one account per role, already active (no
 * Google Sign-In round trip needed for local development). Idempotent:
 * safe to run repeatedly, only ever creates what's missing.
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
