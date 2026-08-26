const pool = require("../config/db");

// LEFT JOIN tenants: a super_admin's tenant_id is NULL by design (§3), so
// this must not turn into an INNER JOIN that would exclude them. t.status
// is Step 9's tenant-facing subscription gate — surfaced on the session
// user object so the frontend can route a pending_payment/suspended
// tenant_admin to billing without a second round-trip (see authService.js
// safeUser()); the backend's own enforcement is the requireActiveTenant
// middleware, never this value alone.
const SELECT_WITH_ROLE = `
  SELECT u.id, u.tenant_id, u.google_id, u.email, u.name, u.avatar_url,
         u.role_id, u.status, u.last_login_at, r.name AS role_name,
         t.status AS tenant_status
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN tenants t ON t.id = u.tenant_id
`;

async function findByEmail(email) {
  const [rows] = await pool.query(`${SELECT_WITH_ROLE} WHERE u.email = ? LIMIT 1`, [email]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query(`${SELECT_WITH_ROLE} WHERE u.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

// Existing-user sign-in and invited-user activation share this one update:
// link the Google account, flip invited -> active, stamp last_login_at.
// (An already-active user's status is left untouched.)
async function markLogin(userId, { googleId }) {
  await pool.query(
    `UPDATE users
     SET google_id = ?,
         status = IF(status = 'invited', 'active', status),
         last_login_at = NOW()
     WHERE id = ?`,
    [googleId, userId]
  );
}

// Runs inside the caller's transaction (see authService.signUpAgency) —
// takes an explicit connection rather than the shared pool.
async function createTenantAdmin(conn, { tenantId, roleId, googleId, email, name, avatarUrl }) {
  const [result] = await conn.query(
    `INSERT INTO users (tenant_id, google_id, email, name, avatar_url, role_id, status, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', NOW())`,
    [tenantId, googleId, email, name, avatarUrl, roleId]
  );
  return result.insertId;
}

async function listByTenant(tenantId) {
  const [rows] = await pool.query(
    `${SELECT_WITH_ROLE} WHERE u.tenant_id = ? ORDER BY u.created_at ASC`,
    [tenantId]
  );
  return rows;
}

// employee_limit counts tenant_employee seats specifically — additional
// Tenant Admin accounts are administrative, not "employees" against the
// seat limit (the column and the UI section are both named for employees).
// Counts invited + active together, since an outstanding invite already
// occupies a seat (§9 of the Final Specification).
async function countEmployeeSeatsUsed(tenantId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS used FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.tenant_id = ? AND r.name = 'tenant_employee' AND u.status IN ('invited', 'active')`,
    [tenantId]
  );
  return row.used;
}

async function createInvited(tenantId, { email, name, roleId }) {
  const [result] = await pool.query(
    `INSERT INTO users (tenant_id, email, name, role_id, status) VALUES (?, ?, ?, ?, 'invited')`,
    [tenantId, email, name, roleId]
  );
  return findById(result.insertId);
}

async function setStatus(tenantId, id, status) {
  const [result] = await pool.query(
    `UPDATE users SET status = ? WHERE id = ? AND tenant_id = ?`,
    [status, id, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findById(id);
}

module.exports = {
  findByEmail,
  findById,
  markLogin,
  createTenantAdmin,
  listByTenant,
  countEmployeeSeatsUsed,
  createInvited,
  setStatus,
};
