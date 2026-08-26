// Wraps an async route handler so a rejected promise reaches Express's
// error handler instead of becoming an unhandled rejection.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
