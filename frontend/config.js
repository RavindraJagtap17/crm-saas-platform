// Runtime configuration — edited per environment, never templated or
// built. Nothing here is a secret: GOOGLE_CLIENT_ID is a public OAuth
// client identifier by design (Google's own Identity Services expects the
// browser to have it), RAZORPAY_KEY_ID is likewise Razorpay's public key
// (Checkout.js is designed to run with it in the browser — the matching
// key_secret never leaves the backend, see backend/src/integrations/
// razorpay/razorpayClient.js), and API_BASE_URL is just where this
// environment's backend lives.
window.CRM_CONFIG = {
  API_BASE_URL: "http://localhost:4000",
  GOOGLE_CLIENT_ID: "785542330678-msha6n6mrsla3vkc9p63cij6nj66jif5.apps.googleusercontent.com",
  RAZORPAY_KEY_ID: "PLACEHOLDER_REPLACE_WITH_REAL_RAZORPAY_TEST_KEY_ID",
};
