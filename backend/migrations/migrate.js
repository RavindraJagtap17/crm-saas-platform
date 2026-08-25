#!/usr/bin/env node
/**
 * Minimal, dependency-free SQL migration runner.
 *
 * Why this instead of a framework: the stack is plain Node.js + MySQL and
 * the spec explicitly asks for "straightforward SQL migrations with a MySQL
 * driver" rather than an ORM. This script IS that — a folder of ordered,
 * plain .sql files plus a small runner built on the same mysql2 driver the
 * application already depends on. No new dependency, no query-building
 * abstraction, nothing hidden: every migration is exactly the SQL that runs.
 *
 * Migration files live in this folder, named `NNN_description.up.sql` and
 * `NNN_description.down.sql`. They run in filename order (hence the
 * zero-padded number prefix), which is what makes execution order
 * deterministic regardless of who authored which file or when.
 *
 * Applied migrations are tracked in a `schema_migrations` table (created
 * automatically on first run) so re-running `up` only applies what's new,
 * and `down` knows exactly what to unwind.
 *
 * Usage:
 *   node migrations/migrate.js up            Apply every pending migration
 *   node migrations/migrate.js down [n]       Roll back the last n migrations (default 1)
 *   node migrations/migrate.js status         List applied vs. pending
 *
 * Or via the npm scripts: npm run migrate / npm run migrate:down / npm run migrate:status
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const MIGRATIONS_DIR = __dirname;
const TRACKING_TABLE = "schema_migrations";

function getConnectionConfig() {
  const required = ["DB_HOST", "DB_NAME", "DB_USER"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required database environment variable(s): ${missing.join(", ")}`);
    console.error("Copy backend/.env.example to backend/.env and fill in the DB_* values first.");
    process.exit(1);
  }
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
    // Migration files may contain more than one SQL statement (a CREATE
    // TABLE plus its comments/constraints). Only this dedicated migration
    // connection enables this — the application's own connection pool
    // (added in a later step) will not, since multi-statement execution is
    // a footgun when combined with any string-built query.
    multipleStatements: true,
  };
}

function listMigrationFiles(suffix) {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(suffix))
    .sort();
}

async function ensureTrackingTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_schema_migrations_name (name)
    ) ENGINE=InnoDB;
  `);
}

async function getAppliedNames(conn) {
  const [rows] = await conn.query(`SELECT name FROM ${TRACKING_TABLE} ORDER BY id ASC`);
  return rows.map((r) => r.name);
}

async function up(conn) {
  await ensureTrackingTable(conn);
  const applied = new Set(await getAppliedNames(conn));
  const files = listMigrationFiles(".up.sql");

  let appliedAny = false;
  for (const file of files) {
    const name = file.replace(/\.up\.sql$/, "");
    if (applied.has(name)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`Applying ${name} ...`);
    await conn.query(sql);
    await conn.query(`INSERT INTO ${TRACKING_TABLE} (name) VALUES (?)`, [name]);
    console.log(`  done.`);
    appliedAny = true;
  }

  if (!appliedAny) console.log("Nothing to apply — database is already up to date.");
}

async function down(conn, steps) {
  await ensureTrackingTable(conn);
  const applied = await getAppliedNames(conn);
  const toRevert = applied.slice(-steps).reverse();

  if (toRevert.length === 0) {
    console.log("Nothing to roll back.");
    return;
  }

  for (const name of toRevert) {
    const downFile = path.join(MIGRATIONS_DIR, `${name}.down.sql`);
    if (!fs.existsSync(downFile)) {
      console.error(`No ${name}.down.sql found — cannot roll back automatically. Stopping.`);
      process.exit(1);
    }
    const sql = fs.readFileSync(downFile, "utf8");
    console.log(`Reverting ${name} ...`);
    await conn.query(sql);
    await conn.query(`DELETE FROM ${TRACKING_TABLE} WHERE name = ?`, [name]);
    console.log(`  done.`);
  }
}

async function status(conn) {
  await ensureTrackingTable(conn);
  const applied = new Set(await getAppliedNames(conn));
  const names = listMigrationFiles(".up.sql").map((f) => f.replace(/\.up\.sql$/, ""));

  console.log("Migration status:");
  for (const name of names) {
    console.log(`  [${applied.has(name) ? "x" : " "}] ${name}`);
  }
  const pending = names.filter((n) => !applied.has(n));
  console.log(pending.length === 0 ? "\nAll migrations applied." : `\n${pending.length} pending.`);
}

async function main() {
  const command = process.argv[2] || "up";
  const conn = await mysql.createConnection(getConnectionConfig());
  try {
    if (command === "up") {
      await up(conn);
    } else if (command === "down") {
      const steps = parseInt(process.argv[3], 10) || 1;
      await down(conn, steps);
    } else if (command === "status") {
      await status(conn);
    } else {
      console.error(`Unknown command "${command}". Use "up", "down [steps]", or "status".`);
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
