const employeeInvitationModel = require("../models/employeeInvitationModel");
const logger = require("../utils/logger");

/**
 * Step 11B — client-invitation-expiry: the scheduler job Step 11A's own
 * comments explicitly deferred ("Expired invitation: not part of this
 * step; scheduler will handle it later" / jobs/index.js's own forward
 * reference). Pure local state transition, no external call — matches
 * clientRenewalService.js's own job-handler shape (a plain async function
 * with no arguments, registered via scheduler.registerJob).
 *
 * Releasing the seat requires NO extra step here: employeeSeatService's
 * pendingInvitations count only ever counts status='pending' rows
 * (unchanged since Step 11A) — the instant a row flips to 'expired', it
 * stops being counted, automatically and correctly, with no dependency
 * between this job and the seat-calculation code at all.
 */
async function runInvitationExpiry() {
  const now = new Date();
  const expiredCount = await employeeInvitationModel.bulkExpirePending(now);
  if (expiredCount > 0) {
    logger.info(`client-invitation-expiry: ${expiredCount} invitation(s) expired.`);
  }

  // Companion cleanup — see deleteInvitedUsersForExpiredInvitations's own
  // comment on why this must happen (frees the email for re-invitation).
  // Run every tick regardless of expiredCount above: also catches any
  // never-activated user row left over from an earlier run that failed
  // partway (this app's process could have restarted between the two
  // statements), keeping the cleanup self-healing rather than relying on
  // both statements always succeeding together.
  const deletedUsers = await employeeInvitationModel.deleteInvitedUsersForExpiredInvitations();
  if (deletedUsers > 0) {
    logger.info(`client-invitation-expiry: ${deletedUsers} never-activated invited user row(s) removed for expired invitations.`);
  }
}

module.exports = { runInvitationExpiry };
