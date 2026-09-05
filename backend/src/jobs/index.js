const scheduler = require("./scheduler");
const { registerClientRenewalJobs } = require("./clientRenewalJobs");
const { registerEmployeeInvitationJobs } = require("./employeeInvitationJobs");

/**
 * Step 9A — the registration point for real business jobs. Step 9B added
 * the first four (Client renewal/grace/cancellation — see
 * clientRenewalJobs.js). Step 11B adds employee invitation expiry (see
 * employeeInvitationJobs.js). Still NOT registered here:
 *   - Agency grace-period expiry
 *   - OAuth token refresh
 * Each will eventually add its own registration call here once its own
 * step implements it.
 */
function registerAllJobs() {
  registerClientRenewalJobs();
  registerEmployeeInvitationJobs();
}

module.exports = { scheduler, registerAllJobs };
