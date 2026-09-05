const pool = require("../config/db");
const { slugify } = require("../utils/slugify");

// employee_limit deliberately excluded: it has no business meaning under
// the B2B2C model (client count is the plan-derived limit; employees are
// unlimited — see clientModel/subscriptionPlanModel). The column itself is
// left in place per the approved migration-safety instructions — dropping
// it is an explicit later cleanup step, not part of this refactor.
const PUBLIC_COLUMNS = `
  id, name, slug, status, logo_url, brand_primary_color,
  theme_settings, subdomain, custom_domain, created_at, updated_at
`;

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

async function findById(id) {
  const [rows] = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM tenants WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function updateBranding(id, { name, logoUrl, brandPrimaryColor }) {
  await pool.query(
    `UPDATE tenants SET
       name = COALESCE(?, name),
       logo_url = COALESCE(?, logo_url),
       brand_primary_color = COALESCE(?, brand_primary_color)
     WHERE id = ?`,
    [name ?? null, logoUrl ?? null, brandPrimaryColor ?? null, id]
  );
  return findById(id);
}

// ---- Super Admin surface: platform-wide, never tenant-scoped ----

async function listAll() {
  const [rows] = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM tenants ORDER BY created_at DESC`
  );
  return rows;
}

// conn is optional and trailing (not the leading-conn convention used
// elsewhere) specifically so the existing superAdminService.js call site
// (updateStatus(id, status), no transaction involved) needs no change —
// Step 9's webhook reconciliation is the only caller that passes one, to
// write this in the same transaction as the subscription state it derives
// this status from (see razorpayWebhookService.js).
async function updateStatus(id, status, conn) {
  const runner = conn || pool;
  const [result] = await runner.query(`UPDATE tenants SET status = ? WHERE id = ?`, [status, id]);
  if (result.affectedRows === 0) return null;
  // Mid-transaction (conn passed), the caller doesn't need the row back —
  // a read via the shared `pool` here wouldn't see this same transaction's
  // still-uncommitted write anyway. Only the no-conn (existing) call site
  // reads it back.
  return conn ? true : findById(id);
}

// totalUsers counts every real account regardless of which scope column
// it carries (agency_admin: tenant_id set; client_admin/employee:
// client_id set; super_admin: neither) — `WHERE tenant_id IS NOT NULL`
// would now silently undercount by excluding every client-level user.
async function platformCounts() {
  const [[{ totalTenants }]] = await pool.query(`SELECT COUNT(*) AS totalTenants FROM tenants`);
  const [byStatusRows] = await pool.query(`SELECT status, COUNT(*) AS count FROM tenants GROUP BY status`);
  const [[{ totalClients }]] = await pool.query(`SELECT COUNT(*) AS totalClients FROM clients`);
  const [[{ totalUsers }]] = await pool.query(`SELECT COUNT(*) AS totalUsers FROM users`);
  const [[{ totalLeads }]] = await pool.query(`SELECT COUNT(*) AS totalLeads FROM leads`);
  return {
    totalTenants,
    totalClients,
    totalUsers,
    totalLeads,
    tenantsByStatus: Object.fromEntries(byStatusRows.map((r) => [r.status, r.count])),
  };
}

module.exports = {
  generateUniqueSlug,
  createTenant,
  findById,
  updateBranding,
  listAll,
  updateStatus,
  platformCounts,
};
