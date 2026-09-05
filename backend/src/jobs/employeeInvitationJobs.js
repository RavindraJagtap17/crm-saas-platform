const scheduler = require("./scheduler");
const employeeInvitationExpiryService = require("../services/employeeInvitationExpiryService");
const config = require("../config");

/**
 * Step 11B — registers the employee-invitation-expiry job onto the Step
 * 9A scheduler framework. Thin wiring only; all business logic lives in
 * employeeInvitationExpiryService.js. Called once from jobs/index.js's
 * registerAllJobs().
 */
function registerEmployeeInvitationJobs() {
  scheduler.registerJob({
    name: "client-invitation-expiry",
    intervalMs: config.scheduler.employeeInvitationExpiryJobIntervalMs,
    handler: employeeInvitationExpiryService.runInvitationExpiry,
  });
}

module.exports = { registerEmployeeInvitationJobs };
