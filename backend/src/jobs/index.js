const scheduler = require("./scheduler");
const { registerEmployeeInvitationJobs } = require("./employeeInvitationJobs");
const { registerIntegrationEventJobs } = require("./integrationEventJobs");

/**
 * The registration point for real background jobs. Client renewal jobs
 * (clientRenewalJobs.js) were removed in the "Agency pays per Client"
 * restructure — there is no Client-level subscription/grace-period
 * lifecycle to sweep any more (client_licenses has no grace period at
 * all: a lapsed license just locks, evaluated lazily by
 * requireActiveTenant on each request, same as everything else in this
 * codebase — no scheduler needed for it). Employee invitation expiry
 * (Step 11B) is unrelated to billing and stays. The integration-events
 * sweep (unified integrations audit) is new — see integrationEventJobs.js.
 */
function registerAllJobs() {
  registerEmployeeInvitationJobs();
  registerIntegrationEventJobs();
}

module.exports = { scheduler, registerAllJobs };
