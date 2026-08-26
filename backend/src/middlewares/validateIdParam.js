const httpError = require("../utils/httpError");

// Rejects an obviously-malformed :id early with a clear 400, rather than
// letting a non-numeric value fall through to a query and come back as a
// confusing 404.
function validateIdParam(paramName = "id") {
  return (req, res, next) => {
    const value = req.params[paramName];
    if (!/^\d+$/.test(String(value))) {
      return next(httpError(`${paramName} must be a positive integer.`, 400));
    }
    next();
  };
}

module.exports = validateIdParam;
