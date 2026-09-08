const app = require("./app");
const config = require("./config");
const logger = require("./utils/logger");
const metaCapiService = require("./services/metaCapiService");
const ingestionService = require("./services/ingestionService");
const { scheduler, registerAllJobs } = require("./jobs");

const server = app.listen(config.port, () => {
  logger.info(`CRM API listening on port ${config.port} [${config.env}]`);
  // Step 8: pick back up any CAPI event left mid-flight by a previous
  // process exiting (queued but never sent, or a backoff timer that died
  // with the old process) — see metaCapiService.runStartupSweep's comment.
  metaCapiService.runStartupSweep();
  // Generic Lead Ingestion Foundation — same recovery, one level generic:
  // any integration_events row left `received` or a due `failed` retry
  // when the previous process exited. No provider uses this yet (Google
  // Ads is the next task), so this is a no-op until then — safe to enable
  // now regardless, exactly like the scheduler infra below already is.
  ingestionService.runStartupSweep();

  // Step 9A: scheduler infrastructure only — registerAllJobs() is
  // currently empty (see jobs/index.js), so enabling this today starts a
  // scheduler with zero registered jobs. Off by default (config.scheduler.enabled).
  if (config.scheduler.enabled) {
    registerAllJobs();
    scheduler.start(config.scheduler.tickIntervalMs);
  } else {
    logger.info("Scheduler disabled (set SCHEDULER_ENABLED=true to start it)");
  }
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);
  scheduler.stop();
  server.close(() => {
    logger.info("Server closed.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = server;
