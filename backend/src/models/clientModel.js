const pool = require("../config/db");

const COLUMNS = `
  id, tenant_id, name, status,
  address, city, gst_number, mobile, contact_email,
  created_at, updated_at
`;

async function listByTenant(tenantId) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM clients WHERE tenant_id = ? ORDER BY created_at ASC`,
    [tenantId]
  );
  return rows;
}

// Scoped to (tenantId, id) throughout — an Agency Admin can only ever
// resolve a client that belongs to their own agency, mirroring the same
// composite-FK-backed isolation pattern already used for every other
// tenant-owned resource.
async function findById(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  return rows[0] || null;
}

// Unscoped by design — this IS the resolution step (client -> owning
// agency) that webhook handling and audit logging need, not a lookup that
// itself requires already knowing the tenant. Never used to authorize a
// request; only ever to log/derive agency context for something already
// resolved from a trusted source (page_id, a client_id already validated
// against req.tenantId, etc.).
async function findTenantIdForClient(clientId) {
  const [rows] = await pool.query(`SELECT tenant_id FROM clients WHERE id = ? LIMIT 1`, [clientId]);
  return rows[0]?.tenant_id ?? null;
}

async function countByTenant(tenantId) {
  const [[row]] = await pool.query(`SELECT COUNT(*) AS total FROM clients WHERE tenant_id = ?`, [tenantId]);
  return row.total;
}

// address/city/gstNumber/mobile/contactEmail (migration 053) — same
// business/KYC fields as tenants (see tenantModel.createTenant's own
// comment); contactEmail is the Client's own business contact address,
// distinct from any individual Client Admin/Employee's own users.email.
async function create(tenantId, { name, address, city, gstNumber, mobile, contactEmail }) {
  const [result] = await pool.query(
    `INSERT INTO clients (tenant_id, name, status, address, city, gst_number, mobile, contact_email)
     VALUES (?, ?, 'active', ?, ?, ?, ?, ?)`,
    [tenantId, name, address ?? null, city ?? null, gstNumber ?? null, mobile ?? null, contactEmail ?? null]
  );
  return findById(tenantId, result.insertId);
}

async function setStatus(tenantId, id, status) {
  const [result] = await pool.query(
    `UPDATE clients SET status = ? WHERE id = ? AND tenant_id = ?`,
    [status, id, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findById(tenantId, id);
}

module.exports = { listByTenant, findById, findTenantIdForClient, countByTenant, create, setStatus };
