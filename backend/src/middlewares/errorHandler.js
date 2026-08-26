const config = require("../config");
const logger = require("../utils/logger");

/**
 * Single place every error in the app funnels through.
 * Keeps stack traces out of responses in production (§24 of the spec).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(err.stack || err.message || err);

  const status = err.status || 500;
  res.status(status).json({
    error: config.isProduction ? "Internal server error" : err.message,
    // Machine-readable — lets the frontend branch on a specific condition
    // (e.g. EMPLOYEE_LIMIT_REACHED) without parsing the human message.
    // Never set for an unexpected 500, only for errors the app raised on
    // purpose via httpError(..., code).
    ...(err.code && status < 500 ? { code: err.code } : {}),
  });
}

module.exports = errorHandler;
