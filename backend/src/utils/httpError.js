// Small, consistent way to throw an error carrying an HTTP status (and an
// optional machine-readable code) from anywhere in the service/validator
// layers. asyncHandler forwards it to errorHandler, which uses err.status.
function httpError(message, status = 500, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

module.exports = httpError;
