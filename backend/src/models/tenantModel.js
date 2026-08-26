const { slugify } = require("../utils/slugify");

// Runs inside the caller's transaction connection throughout — tenant
// creation and slug uniqueness must be checked against the same
// in-progress transaction, not a possibly-stale pooled connection.

async function isSlugTaken(conn, slug) {
  const [rows] = await conn.query("SELECT id FROM tenants WHERE slug = ? LIMIT 1", [slug]);
  return rows.length > 0;
}

async function generateUniqueSlug(conn, name) {
  const base = slugify(name) || "agency";
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await isSlugTaken(conn, candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

// employee_limit is deliberately omitted — it takes the schema's own
// DEFAULT 3 (see migrations/006../tenants), so the "starts at 3" rule
// lives in exactly one place rather than being repeated here.
async function createTenant(conn, { name, slug }) {
  const [result] = await conn.query(
    `INSERT INTO tenants (name, slug, status) VALUES (?, ?, 'pending_payment')`,
    [name, slug]
  );
  return result.insertId;
}

module.exports = { generateUniqueSlug, createTenant };
