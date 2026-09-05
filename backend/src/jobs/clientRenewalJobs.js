const scheduler = require("./scheduler");
const clientRenewalService = require("../services/clientRenewalService");
const config = require("../config");

/**
 * Step 9B — registers the 4 Client renewal/grace jobs onto the Step 9A
 * scheduler framework. Thin wiring only; all business logic lives in
 * clientRenewalService.js. Called once from jobs/index.js's
 * registerAllJobs(). Registration order matters only for logging
 * readability — each job's own eligibility WHERE clause (in
 * clientSubscriptionModel.js) is what actually keeps them from
 * interfering with each other, not registration order.
 */
function registerClientRenewalJobs() {
  scheduler.registerJob({
    name: "client-renewal-orders",
    intervalMs: config.scheduler.clientRenewalJobIntervalMs,
    handler: clientRenewalService.runRenewalOrderCreation,
  });
  scheduler.registerJob({
    name: "client-renewal-grace",
    intervalMs: config.scheduler.clientRenewalJobIntervalMs,
    handler: clientRenewalService.runGraceTransition,
  });
  scheduler.registerJob({
    name: "client-grace-expiry",
    intervalMs: config.scheduler.clientRenewalJobIntervalMs,
    handler: clientRenewalService.runGraceExpiry,
  });
  scheduler.registerJob({
    name: "client-cancellation-expiry",
    intervalMs: config.scheduler.clientRenewalJobIntervalMs,
    handler: clientRenewalService.runCancellationExpiry,
  });
}

module.exports = { registerClientRenewalJobs };
