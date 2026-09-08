// Resolved relative to this file, not process.cwd() — dotenv's default
// path is cwd-relative, which silently finds nothing if the app is ever
// launched from outside backend/ (e.g. `node backend/src/server.js` from
// the repo root).
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

/**
 * Central place every environment variable is read from.
 * Nothing else in the codebase should touch process.env directly.
 *
 * REQUIRED lists which variables must be set for the app to boot at all.
 * It grows as each step adds a real dependency on something — Step 1 needed
 * nothing, Step 2's database work only affected the separate migration/seed
 * scripts, and Step 3 is the first time the running app itself needs the
 * database and needs Google/JWT secrets to authenticate anyone. A missing
 * value now fails loudly at startup instead of at first request.
 */
const REQUIRED = [
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "GOOGLE_CLIENT_ID",
  "ENCRYPTION_KEY",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_WEBHOOK_VERIFY_TOKEN",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
];

function readList(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(",").map((v) => v.trim()).filter(Boolean);
}

function validate() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
      `Copy .env.example to .env and fill them in.`
    );
  }
}

validate();

const config = {
  env: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT, 10) || 4000,
  appUrl: process.env.APP_URL || "http://localhost:4000",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  corsAllowedOrigins: readList("CORS_ALLOWED_ORIGINS"),
  logLevel: process.env.LOG_LEVEL || "info",

  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    poolMin: parseInt(process.env.DB_POOL_MIN, 10) || 2,
    poolMax: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    // Also used (as an HMAC key, not for signing a JWT) to hash refresh
    // tokens before they're stored — see src/utils/refreshToken.js.
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || "15m",
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || "30d",
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
  },

  // 64-char hex string (32 bytes) — see src/utils/encryption.js. Used to
  // encrypt Meta access tokens at rest.
  encryptionKey: process.env.ENCRYPTION_KEY,

  meta: {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
    graphApiVersion: process.env.META_GRAPH_API_VERSION || "v19.0",
    // Where Meta redirects the browser back to after the user
    // authorizes — defaults to this API's own origin so it works out of
    // the box in any environment without a separate var to keep in sync.
    redirectUri: process.env.META_REDIRECT_URI || `${process.env.APP_URL || "http://localhost:4000"}/api/meta/oauth/callback`,
  },

  // Deliberately NOT in REQUIRED above, unlike meta.* — this integration
  // is opt-in per deployment (LinkedIn's Lead Sync API needs a separate
  // program approval most environments won't have yet), and every other
  // integration/route in this app must keep booting fine without it. A
  // clientId/clientSecret check happens lazily, only when the LinkedIn
  // connect flow is actually invoked (see linkedinLeadFormService.js).
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri: process.env.LINKEDIN_REDIRECT_URI || `${process.env.APP_URL || "http://localhost:4000"}/api/integrations/linkedin/oauth/callback`,
    // YYYYMM per LinkedIn's own "Linkedin-Version" header requirement —
    // see https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/leadsync.
    apiVersion: process.env.LINKEDIN_API_VERSION || "202608",
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },

  // Scheduler infrastructure only, no business jobs registered yet besides
  // employee-invitation expiry (see src/jobs/index.js). Deliberately NOT
  // in REQUIRED above and defaults to disabled: there is nothing for it to
  // run yet, so an environment that hasn't opted in should see no
  // behavior change at all from this existing. tickIntervalMs is how
  // often the scheduler polls registered jobs to see if they're due — not
  // a cron string, see jobs/scheduler.js's header comment on the
  // server-time/UTC convention.
  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED === "true",
    tickIntervalMs: parseInt(process.env.SCHEDULER_TICK_INTERVAL_MS, 10) || 60000,
    // Step 11B — how often (ms) the employee-invitation-expiry job runs
    // (see jobs/employeeInvitationJobs.js). Invitations expire on a 7-day
    // cycle (userService.js's INVITATION_EXPIRY_DAYS), so hourly polling
    // is comfortably granular here too.
    employeeInvitationExpiryJobIntervalMs: parseInt(process.env.EMPLOYEE_INVITATION_EXPIRY_JOB_INTERVAL_MS, 10) || 3600000,
  },
};

module.exports = config;
