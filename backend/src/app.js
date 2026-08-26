const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const config = require("./config");
const routes = require("./routes");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

// Behind Plesk's reverse proxy in production, req.ip would otherwise be
// the proxy's own address for every request — this makes it the real
// client IP instead, which is what the public form's rate limiter keys
// on (§G). "1" trusts exactly one hop, matching a single reverse proxy.
if (config.isProduction) {
  app.set("trust proxy", 1);
}

app.use(helmet());

// The strict, credentialed CORS policy below is for OUR OWN frontend
// only. /api/public/* (Step 6's embeddable form) is reachable from any
// tenant's website and configures its own separate, non-credentialed
// CORS policy in publicForm.routes.js — so it's explicitly excluded here
// rather than fighting two CORS middlewares over the same response.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/public/")) return next();
  return cors({
    origin: config.corsAllowedOrigins.length > 0 ? config.corsAllowedOrigins : false,
    // Refresh tokens travel as an httpOnly cookie, which requires the
    // browser to be told cross-origin credentials are allowed — paired
    // deliberately with an explicit origin allowlist above, never a
    // wildcard, since credentials + "*" is not something browsers allow
    // anyway and would be insecure if they did.
    credentials: true,
  })(req, res, next);
});

// Same exclusion as the CORS middleware above, and for the same reason:
// the public router applies its own smaller body-size limit
// (publicForm.routes.js), which would never take effect if this general
// 100kb parser already consumed the request body first.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/public/")) return next();
  return express.json()(req, res, next);
});
app.use(cookieParser());
app.use(morgan(config.isProduction ? "combined" : "dev"));

app.use(routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
