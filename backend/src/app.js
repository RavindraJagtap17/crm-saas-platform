const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const config = require("./config");
const routes = require("./routes");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");
const { UPLOAD_ROOT } = require("./utils/uploadStorage");

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
// /api/meta/webhook (Step 7), /api/razorpay/webhook (Step 9), and
// /api/integrations/linkedin/webhook/:token are excluded too: none of
// Meta's, Razorpay's, or LinkedIn's servers involve a browser/Origin at
// all, so our own CORS policy is simply irrelevant to them.
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/public/") ||
    req.path === "/api/meta/webhook" ||
    req.path === "/api/razorpay/webhook" ||
    req.path === "/api/razorpay/oauth-webhook" ||
    req.path === "/api/razorpay/client-webhook" ||
    req.path.startsWith("/api/integrations/linkedin/webhook/")
  )
    return next();
  return cors({
    origin: config.corsAllowedOrigins.length > 0 ? config.corsAllowedOrigins : false,
    // Refresh tokens travel as an httpOnly cookie, which requires the
    // browser to be told cross-origin credentials are allowed — paired
    // deliberately with an explicit origin allowlist above, never a
    // wildcard, since credentials + "*" is not something browsers allow
    // anyway and would be insecure if they did.
    credentials: true,
    // Content-Disposition isn't on the small set of response headers a
    // browser exposes to cross-origin fetch() by default — without this,
    // the server sends the right filename but api.download() (client.js)
    // can never read it, silently falling back to a generic name. Needed
    // for Lead CSV Export (leads-*.csv); harmless for every other
    // response, which simply doesn't set this header at all.
    exposedHeaders: ["Content-Disposition"],
  })(req, res, next);
});

// Same exclusion as the CORS middleware above, and for the same reason:
// the public router applies its own smaller body-size limit
// (publicForm.routes.js), which would never take effect if this general
// parser already consumed the request body first. /api/meta/webhook,
// /api/razorpay/webhook, and /api/integrations/linkedin/webhook/:token
// are excluded for a different but related reason: each applies its own
// express.json({verify}) to capture the exact raw bytes its provider
// sent, which signature verification requires in all three cases — that
// capture would never run if this global parser consumed the body first
// (body-parser only ever reads the request stream once).
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/public/") ||
    req.path === "/api/meta/webhook" ||
    req.path === "/api/razorpay/webhook" ||
    req.path === "/api/razorpay/oauth-webhook" ||
    req.path === "/api/razorpay/client-webhook" ||
    req.path.startsWith("/api/integrations/linkedin/webhook/")
  )
    return next();
  return express.json()(req, res, next);
});
app.use(cookieParser());
app.use(morgan(config.isProduction ? "combined" : "dev"));

// White-label Phase 1: serves uploaded tenant logos/favicons
// (tenant.routes.js's POST /api/tenant/logo|favicon). Public and
// unauthenticated by design — a logo must be reachable as a plain <img
// src>, the same expectation the old pasted-URL logoUrl field already had.
// Read-only: nothing under this path is ever written to except by
// uploadStorage.js, and never from a client-supplied path segment.
//
// helmet()'s default Cross-Origin-Resource-Policy: same-origin (set
// above, and correct for every other route) blocks the browser from
// actually rendering an <img>/<link rel="icon"> pointed at this path from
// the frontend's own origin, which is a different origin from this API
// (see API_BASE_URL in the frontend's client.js) — CORS alone does not
// govern this, CORP is a separate, stricter check. Relaxed to
// cross-origin only for this one static, public, read-only path.
app.use("/uploads", helmet.crossOriginResourcePolicy({ policy: "cross-origin" }), express.static(UPLOAD_ROOT));

app.use(routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
