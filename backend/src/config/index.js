require("dotenv").config();

/**
 * Central place every environment variable is read from.
 * Nothing else in the codebase should touch process.env directly.
 *
 * REQUIRED lists which variables must be set for the app to boot at all.
 * It starts small on purpose — Step 1 only needs the app to serve /health.
 * Later steps (DB, Google Sign-In, Meta, Razorpay) add their own required
 * variables here as those integrations are actually implemented, so a
 * missing secret fails loudly at startup instead of at first use.
 */
const REQUIRED = [];

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
};

module.exports = config;
