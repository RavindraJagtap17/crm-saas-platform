#!/usr/bin/env node
/**
 * Seeds the 3 approved roles. This is reference data the application
 * cannot function without (every user row needs a role_id) — not sample
 * or demo data — which is why it's kept separate from the migrations
 * folder (schema changes) as its own concern, per the approved spec's
 * folder structure.
 *
 * Safe to re-run: existing rows are left untouched (ON DUPLICATE KEY
 * UPDATE is a no-op here), nothing is duplicated or overwritten.
 *
 * Deliberately does NOT create any tenant, user, or account — seeding
 * an actual Super Admin account is an account-provisioning concern for
 * a later (authentication) step, not a schema-seeding one.
 */

require("dotenv").config();
const mysql = require("mysql2/promise");

const ROLES = ["super_admin", "tenant_admin", "tenant_employee"];

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
  };
}

async function main() {
  const conn = await mysql.createConnection(getConnectionConfig());
  try {
    for (const name of ROLES) {
      await conn.query("INSERT INTO roles (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name", [name]);
      console.log(`Seeded role: ${name}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err.message);
  process.exit(1);
});
