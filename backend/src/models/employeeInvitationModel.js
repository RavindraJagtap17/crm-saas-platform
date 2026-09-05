const pool = require("../config/db");

// Step 11A — wires up migration 046's employee_invitations table, until
// now schema-only (see that migration's own header comment: "this
// migration only adds the schema... wiring the two together is backend
// work for a later step"). This IS that step, scoped narrowly to seat
// enforcement: a pending row reserves one seat; 'cancelled'/'accepted'
// are its own already-existing status values (never invented here).
//
// Deliberately does NOT replace the existing users.status='invited' row
// created by userService.invite — that row is what lets the existing
// Google-Sign-In activation flow (authService.signInWithGoogle) keep
// working completely unchanged. This table exists ALONGSIDE it purely to
// give the invitation its own trackable lifecycle (pending/cancelled/
// accepted/expired) with a real 'cancelled' state, which users.status
// has no equivalent for.
const COLUMNS = `
  id, client_id, email, name, invited_by, status, expires_at, accepted_user_id, created_at, updated_at
`;

// Locked into the seat-usage transaction via `conn` when called from
// employeeSeatService — counts only 'pending' rows, exactly what "reserves
// a seat" means for this table.
async function countPendingForClient(clientId, conn) {
  const runner = conn || pool;
  const [[row]] = await runner.query(
    `SELECT COUNT(*) AS c FROM employee_invitations WHERE client_id = ? AND status = 'pending'`,
    [clientId]
  );
  return row.c;
}

async function create(conn, clientId, { email, name, invitedBy, expiresAt }) {
  const runner = conn || pool;
  const [result] = await runner.query(
    `INSERT INTO employee_invitations (client_id, email, name, invited_by, status, expires_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
    [clientId, email, name, invitedBy, expiresAt]
  );
  const [rows] = await runner.query(`SELECT ${COLUMNS} FROM employee_invitations WHERE id = ?`, [result.insertId]);
  return rows[0];
}

async function findByIdForClient(clientId, id) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM employee_invitations WHERE id = ? AND client_id = ? LIMIT 1`, [id, clientId]);
  return rows[0] || null;
}

async function listPendingForClient(clientId) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM employee_invitations WHERE client_id = ? AND status = 'pending' ORDER BY created_at ASC`,
    [clientId]
  );
  return rows;
}

// Client-scoped and status-guarded in the WHERE clause itself — an
// already-accepted/cancelled/expired invitation, or one belonging to a
// DIFFERENT client, simply matches zero rows rather than needing a
// separate ownership check first. Only a 'pending' row can ever be
// cancelled, matching the migration's own status enum (never invents a
// new one).
async function cancel(clientId, id) {
  const [result] = await pool.query(
    `UPDATE employee_invitations SET status = 'cancelled' WHERE id = ? AND client_id = ? AND status = 'pending'`,
    [id, clientId]
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM employee_invitations WHERE id = ?`, [id]);
  return rows[0];
}

/**
 * Called from authService.signInWithGoogle at the exact moment an invited
 * user's first Google sign-in activates them (existing, unchanged
 * mechanism) — marks the matching PENDING invitation 'accepted' and links
 * accepted_user_id, so the seat correctly moves from "pending" to
 * "active" accounting without ever being double-counted or silently
 * dropped. A safe no-op (affects 0 rows) for any activation that has no
 * matching pending invitation — e.g. a client_admin's own invite, which
 * never creates an employee_invitations row at all (see userService.js).
 */
async function markAcceptedByEmail(clientId, email, acceptedUserId, conn) {
  const runner = conn || pool;
  await runner.query(
    `UPDATE employee_invitations SET status = 'accepted', accepted_user_id = ? WHERE client_id = ? AND email = ? AND status = 'pending'`,
    [acceptedUserId, clientId, email]
  );
}

/**
 * Step 11B — client-invitation-expiry scheduler job: PENDING -> EXPIRED
 * for any invitation whose expires_at has passed. A single atomic bulk
 * UPDATE (same "pure local state transition, no external call, do it as
 * one statement" reasoning as clientSubscriptionModel's own bulk*
 * functions) — MySQL evaluates the WHERE clause against committed state
 * at execution time, so two racing scheduler ticks (or a concurrent
 * cancel/accept landing at the same moment) can never double-transition
 * the same row: whichever runs first flips status away from 'pending',
 * and the guard here means the other one simply matches zero rows for it.
 * 'expired' is the exact existing status this table's own enum already
 * defines (migration 046) — never invented here.
 */
async function bulkExpirePending(now) {
  const [result] = await pool.query(`UPDATE employee_invitations SET status = 'expired' WHERE status = 'pending' AND expires_at < ?`, [now]);
  return result.affectedRows;
}

/**
 * Step 11B — the companion cleanup: an expired invitation's never-
 * activated users(status='invited') row must also go, for the exact same
 * reason cancelInvitation already deletes it (userService.js) —
 * users.email is globally UNIQUE, so leaving a dead 'invited' row behind
 * would permanently block that email from ever being re-invited.
 *
 * Matches only when the MOST RECENT invitation (highest id) for that
 * exact (client_id, email) pair is the 'expired' one — NOT merely "some
 * expired invitation exists for this email" — deliberately, to stay
 * correct after a re-invite: cancelling/expiring never deletes the OLD
 * invitation row (kept for history), so a fresh re-invitation for the
 * same email creates a NEW 'pending' row while the old one stays
 * 'expired' forever. A naive "any expired match" join would then delete
 * the BRAND NEW re-invitation's own users row the very next time this
 * job runs — this subquery is what prevents that. Safe to re-run on
 * every tick: a row already deleted simply no longer matches.
 */
async function deleteInvitedUsersForExpiredInvitations() {
  const [result] = await pool.query(
    `DELETE u FROM users u
     WHERE u.status = 'invited'
       AND EXISTS (
         SELECT 1 FROM employee_invitations ei
         WHERE ei.client_id = u.client_id AND ei.email = u.email AND ei.status = 'expired'
           AND ei.id = (
             SELECT MAX(ei2.id) FROM employee_invitations ei2
             WHERE ei2.client_id = u.client_id AND ei2.email = u.email
           )
       )`
  );
  return result.affectedRows;
}

module.exports = {
  countPendingForClient,
  create,
  findByIdForClient,
  listPendingForClient,
  cancel,
  markAcceptedByEmail,
  bulkExpirePending,
  deleteInvitedUsersForExpiredInvitations,
};
