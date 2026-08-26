const app = require("./app");
const config = require("./config");
const logger = require("./utils/logger");
const metaCapiService = require("./services/metaCapiService");

const server = app.listen(config.port, () => {
  logger.info(`CRM API listening on port ${config.port} [${config.env}]`);
  // Step 8: pick back up any CAPI event left mid-flight by a previous
  // process exiting (queued but never sent, or a backoff timer that died
  // with the old process) — see metaCapiService.runStartupSweep's comment.
  metaCapiService.runStartupSweep();
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    logger.info("Server closed.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = server;
