const rateLimit = require("express-rate-limit");

// Step 10 §J: authentication and refresh endpoints had no rate limiting —
// the public enquiry form (Step 6) was the only protected surface. These
// two limiters close that gap, matching the same library/pattern already
// established there (publicForm.routes.js).
//
// signInLimiter guards /api/auth/google and /api/auth/signup — each call
// verifies a Google ID token (an outbound call to Google) and, for
// /google, looks up a user by email; both are worth protecting from
// automated hammering. 20/15min is generous for a real user retrying a
// broken sign-in a few times, tight enough to blunt brute-force/abuse.
const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many sign-in attempts from this network. Please try again later." });
  },
});

// refreshLimiter guards /api/auth/refresh — called once per page load by
// every legitimate session (see session.js's bootstrapSession), so this
// needs real headroom for normal multi-tab/multi-page use while still
// bounding automated refresh-token guessing/brute-forcing.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many requests from this network. Please try again shortly." });
  },
});

module.exports = { signInLimiter, refreshLimiter };
