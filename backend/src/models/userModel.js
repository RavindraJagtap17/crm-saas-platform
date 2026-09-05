const pool = require("../config/db");

// B2B2C restructure: a user's row now carries EITHER u.tenant_id (agency_admin
// — agency-scoped, no client) OR u.client_id (client_admin/client_employee —
// client-scoped; their owning agency is NOT duplicated onto the user row,
// it's derived here via clients.tenant_id) OR neither (super_admin). Both
// LEFT JOINs are required — an INNER JOIN on either would silently exclude
// whichever role doesn't carry that particular column.
//
// effective_tenant_id / effective_tenant_status / effective_client_status
// are what every caller (JWT issuance, safeUser, the scope middlewares)
// should read — never u.tenant_id directly, since that's NULL for every
// client-level user by design.
const SELECT_WITH_ROLE = `
  SELECT u.id, u.tenant_id, u.client_id, u.google_id, u.email, u.name, u.avatar_url,
         u.role_id, u.status, u.last_login_at, r.name AS role_name,
         c.status AS client_status,
         COALESCE(u.tenant_id, c.tenant_id) AS effective_tenant_id,
         COALESCE(t.status, ct.status) AS effective_tenant_status
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN tenants t ON t.id = u.tenant_id
  LEFT JOIN clients c ON c.id = u.client_id
  LEFT JOIN tenants ct ON ct.id = c.tenant_id
`;

async function findByEmail(email) {
  const [rows] = await pool.query(`${SELECT_WITH_ROLE} WHERE u.email = ? LIMIT 1`, [email]);
  return rows[0] || null;
}

// conn is optional and trailing (matches tenantModel.updateStatus's own
// convention) so every existing call site (just an id) is unaffected —
// only authService's new self-service-signup path needs to read the row
// back inside its own still-open transaction, where a plain pool read
// wouldn't see the uncommitted insert yet.
async function findById(id, conn) {
  const runner = conn || pool;
  const [rows] = await runner.query(`${SELECT_WITH_ROLE} WHERE u.id = ? LIMIT 1`, [id]);
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

// Agency-level roster (agency_admin only, now that client_admin/employee
// carry client_id instead) — used by Super Admin's tenant detail view.
async function listByTenant(tenantId) {
  const [rows] = await pool.query(
    `${SELECT_WITH_ROLE} WHERE u.tenant_id = ? ORDER BY u.created_at ASC`,
    [tenantId]
  );
  return rows;
}

// Client-level roster (client_admin + client_employee) — used by a Client
// Admin managing their own team. Employee count is deliberately
// unenforced/unlimited in the B2B2C model (only the agency's client count
// is subscription-limited), so there is no seats-used counter here.
async function listByClient(clientId) {
  const [rows] = await pool.query(
    `${SELECT_WITH_ROLE} WHERE u.client_id = ? ORDER BY u.created_at ASC`,
    [clientId]
  );
  return rows;
}

// Agency-scoped invite (Super Admin -> first Agency Admin for a tenant;
// mirrors the pre-existing invite->status:invited->activate-on-first-
// Google-signin pattern one level up).
async function createInvited(tenantId, { email, name, roleId }) {
  const [result] = await pool.query(
    `INSERT INTO users (tenant_id, email, name, role_id, status) VALUES (?, ?, ?, ?, 'invited')`,
    [tenantId, email, name, roleId]
  );
  return findById(result.insertId);
}

// Client-scoped invite (Agency Admin -> first Client Admin for one of
// their clients; Client Admin -> client_employee) — same activation
// pattern, just keyed on client_id instead of tenant_id. conn is optional
// and trailing (Step 11A: userService.invite runs this inside the same
// seat-locking transaction as its capacity check).
async function createInvitedForClient(clientId, { email, name, roleId }, conn) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT INTO users (client_id, email, name, role_id, status) VALUES (?, ?, ?, ?, 'invited')`,
    [clientId, email, name, roleId]
  );
  return findById(result.insertId, conn);
}

// Self-service Agency signup only (authService.signUpAgency) — the
// signing-up person has ALREADY verified their identity via a Google ID
// token before this is ever called, so unlike every other creation path
// in this file (createInvited/createInvitedForClient, both start
// 'invited'), the resulting account starts 'active' with google_id
// already linked — there is no separate invite-then-activate step to go
// through. conn is required (not optional) since this always runs inside
// authService's tenant-creation transaction, never standalone.
async function createActiveAgencyAdmin(conn, tenantId, { email, name, googleId, avatarUrl, roleId }) {
  const [result] = await conn.query(
    `INSERT INTO users (tenant_id, email, name, google_id, avatar_url, role_id, status, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', NOW())`,
    [tenantId, email, name, googleId, avatarUrl ?? null, roleId]
  );
  return findById(result.insertId, conn);
}

async function setStatus(tenantId, id, status) {
  const [result] = await pool.query(
    `UPDATE users SET status = ? WHERE id = ? AND tenant_id = ?`,
    [status, id, tenantId]
  );
  if (result.affectedRows === 0) return null;
  return findById(id);
}

// Step 11A — client-scoped single-row lookup (role_name included via
// SELECT_WITH_ROLE) for the pre-checks setStatus/reactivate need:
// ownership, current status, and role (never deactivate a client_admin).
async function findByIdForClient(clientId, id) {
  const [rows] = await pool.query(`${SELECT_WITH_ROLE} WHERE u.id = ? AND u.client_id = ? LIMIT 1`, [id, clientId]);
  return rows[0] || null;
}

// Step 11A — the seat-check-guarded reactivation: only ever applies if
// the row is STILL 'deactivated' at the moment this runs (guards against
// two concurrent reactivate requests both passing the earlier capacity
// check and both writing — belt-and-suspenders alongside the
// client_subscriptions row lock employeeSeatService already takes for
// the whole operation). Returns null if the guard fails, exactly like
// this codebase's other optimistic-concurrency writes.
async function reactivateForClient(conn, clientId, id) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `UPDATE users SET status = 'active' WHERE id = ? AND client_id = ? AND status = 'deactivated'`,
    [id, clientId]
  );
  if (result.affectedRows === 0) return null;
  return findById(id, conn);
}

async function deactivateForClient(clientId, id) {
  const [result] = await pool.query(
    `UPDATE users SET status = 'deactivated' WHERE id = ? AND client_id = ? AND status = 'active'`,
    [id, clientId]
  );
  if (result.affectedRows === 0) return null;
  return findById(id);
}

// Step 11A — the ACTIVE headcount that actually consumes a seat. Joins
// roles to scope strictly to client_employee — a client_admin is not
// counted against max_active_employees (a separate concept; see
// clientService.inviteClientAdmin, untouched by this step). conn is
// optional so this can run inside employeeSeatService's locked
// transaction when called from a capacity-checked write path.
async function countActiveEmployeesForClient(clientId, conn) {
  const runner = conn || pool;
  const [[row]] = await runner.query(
    `SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id WHERE u.client_id = ? AND u.status = 'active' AND r.name = 'client_employee'`,
    [clientId]
  );
  return row.c;
}

// Step 11A — cancelling a pending invitation must free its email for
// re-invitation (users.email is globally UNIQUE). Only ever deletes a row
// that is STILL exactly 'invited' (never activated, so nothing else —
// no lead assignments, no login history — could reference it) and
// belongs to this client; scoped by email too so it can only ever remove
// the specific never-activated row the cancelled invitation itself
// created, never an unrelated account that happens to share client_id.
async function deleteInvitedByClientAndEmail(clientId, email) {
  await pool.query(`DELETE FROM users WHERE client_id = ? AND email = ? AND status = 'invited'`, [clientId, email]);
}

module.exports = {
  findByEmail,
  findById,
  markLogin,
  listByTenant,
  listByClient,
  createInvited,
  createInvitedForClient,
  createActiveAgencyAdmin,
  setStatus,
  findByIdForClient,
  reactivateForClient,
  deactivateForClient,
  countActiveEmployeesForClient,
  deleteInvitedByClientAndEmail,
};
