// Runtime configuration — edited per environment, never templated or
// built. Nothing here is a secret: GOOGLE_CLIENT_ID is a public OAuth
// client identifier by design (Google's own Identity Services expects the
// browser to have it), and API_BASE_URL is just where this environment's
// backend lives.
window.CRM_CONFIG = {
  API_BASE_URL: "http://localhost:4000",
  GOOGLE_CLIENT_ID: "PLACEHOLDER_REPLACE_WITH_REAL_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
};
