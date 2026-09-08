const scheduler = require("./scheduler");
const ingestionService = require("../services/ingestionService");
const config = require("../config");

/**
 * Unified integrations audit — registers ingestionService.runStartupSweep
 * as a RECURRING job, not just the one-time boot-time call server.js
 * already makes. Thin wiring only, same shape as
 * employeeInvitationJobs.js; all logic lives in ingestionService itself
 * (it's already safe to call repeatedly — see its own comment). Covers
 * every current and future provider that uses the generic ingestion
 * foundation (Meta's own metaCapiService queue is separate and unaffected).
 */
function registerIntegrationEventJobs() {
  scheduler.registerJob({
    name: "integration-events-sweep",
    intervalMs: config.scheduler.integrationEventsSweepJobIntervalMs,
    handler: ingestionService.runStartupSweep,
  });
}

module.exports = { registerIntegrationEventJobs };
