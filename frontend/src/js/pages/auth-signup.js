import { GOOGLE_CLIENT_ID, homeForRole, bootstrapSession, isDevBackend } from "../session.js";
import { authApi } from "../api/resources.js";
import { escapeHtml } from "../components/ui.js";

/**
 * Self-service Agency signup (finalized business model: "Agency signup is
 * self-service... signup person becomes Agency Admin"). Rebuilt against
 * the real, already-working POST /api/auth/signup — this page previously
 * told every visitor signup wasn't available at all, contradicting the
 * backend's own working flow (see the Agency-billing migration report).
 *
 * Extended for the "Agency pays per Client" restructure: registration now
 * also collects the Agency's own business/KYC details (address, city,
 * GST, mobile, contact email) — all required, validated server-side by
 * agencySubscriptionValidators.validateSignupAgency and stored directly
 * on tenants (migration 052).
 *
 * Google Identity Services' rendered button fires its callback the moment
 * an account is picked — it cannot be gated on form fields the way a
 * normal submit button can. So every field is validated inside the
 * callback itself: any invalid field shows an inline error and does not
 * call the API; the user fixes it and clicks the Google button again (a
 * fresh, valid credential each time — safe to request repeatedly).
 *
 * No Razorpay Checkout logic lives here on purpose: a fresh agency starts
 * tenants.status = 'pending_payment', so the very next page (home for
 * agency_admin) is redirected by shell.js's own blocked-redirect straight
 * to /public/agency/billing.html, which already handles both outcomes of
 * signup's best-effort subscription attempt (a 'pending' subscription to
 * resume payment on, or none yet to subscribe fresh) — reusing that page
 * instead of duplicating checkout handling here.
 */
function isPlaceholder(id) {
  return !id || id.startsWith("PLACEHOLDER");
}

function showAlert(html, type = "danger") {
  document.getElementById("alert-slot").innerHTML = `<div class="alert alert-${type}" role="alert">${html}</div>`;
}

function clearAlert() {
  document.getElementById("alert-slot").innerHTML = "";
}

const FIELDS = [
  { id: "su-agency-name", key: "name", label: "agency name" },
  { id: "su-address", key: "address", label: "address" },
  { id: "su-city", key: "city", label: "city" },
  { id: "su-gst", key: "gstNumber", label: "GST number" },
  { id: "su-mobile", key: "mobile", label: "mobile number" },
  { id: "su-contact-email", key: "contactEmail", label: "contact email" },
];

function showFieldError(fieldId, message) {
  document.getElementById(`${fieldId}-error`).textContent = message;
  document.getElementById(`${fieldId}-error`).hidden = !message;
}

function clearFieldErrors() {
  FIELDS.forEach((f) => showFieldError(f.id, ""));
}

// Loose, client-side sanity checks only — mirrors the server's own
// validators (agencySubscriptionValidators.validateSignupAgency /
// primitives.isGstin/isPhoneNumber/isLikelyEmail) just closely enough to
// give a same-field inline error instead of a generic alert; the server
// remains the actual authority.
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readAndValidateFields() {
  clearFieldErrors();
  const values = {};
  let firstInvalidId = null;

  FIELDS.forEach((f) => {
    values[f.key] = document.getElementById(f.id).value.trim();
  });

  const fail = (fieldId, message) => {
    showFieldError(fieldId, message);
    if (!firstInvalidId) firstInvalidId = fieldId;
  };

  if (!values.name) fail("su-agency-name", "Agency name is required.");
  if (!values.address) fail("su-address", "Address is required.");
  if (!values.city) fail("su-city", "City is required.");
  if (!GSTIN_PATTERN.test(values.gstNumber.toUpperCase())) fail("su-gst", "Enter a valid 15-character GSTIN.");
  else values.gstNumber = values.gstNumber.toUpperCase();
  if (!PHONE_PATTERN.test(values.mobile)) fail("su-mobile", "Enter a valid mobile number.");
  if (!EMAIL_PATTERN.test(values.contactEmail)) fail("su-contact-email", "Enter a valid email address.");

  if (firstInvalidId) {
    document.getElementById(firstInvalidId).focus();
    return null;
  }
  return values;
}

async function handleCredentialResponse(response) {
  clearAlert();
  const fields = readAndValidateFields();
  if (!fields) return;

  try {
    const { user } = await authApi.signup(response.credential, fields);
    window.location.href = homeForRole(user.role);
  } catch (err) {
    if (err.code === "ACCOUNT_EXISTS") {
      showAlert(`${escapeHtml(err.message)} <a href="./index.html">Sign in instead</a>`);
    } else {
      showAlert(err.message || "Signup failed. Please try again.");
    }
  }
}

function initGoogleButton() {
  if (isPlaceholder(GOOGLE_CLIENT_ID)) {
    document.getElementById("gsi-fallback-note").style.display = "block";
    return;
  }
  window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
  window.google.accounts.id.renderButton(document.getElementById("gsi-button"), {
    theme: "outline",
    size: "large",
    width: 320,
    text: "signup_with",
  });
}

/**
 * Development-only note: unlike sign-in, there is no dev bypass for
 * signup — POST /api/auth/signup always verifies a real Google ID token
 * (see backend/src/integrations/google/verifyIdToken.js), so this flow
 * cannot be exercised with the seeded dev-login accounts. Point dev users
 * at Sign In's dev panel instead of pretending a shortcut exists here.
 */
async function initDevNote() {
  const isDev = await isDevBackend();
  if (!isDev) return;
  document.getElementById("dev-note-slot").innerHTML = `
    <div class="card card-pad mt-4" style="border-style:dashed">
      <p class="text-xs text-tertiary font-semibold mb-2">DEVELOPMENT — not available in production</p>
      <p class="text-sm text-secondary">Signup always requires a real Google account — there's no dev bypass for it. Use Sign In's dev panel to sign in as an already-seeded account instead.</p>
    </div>`;
}

async function main() {
  const user = await bootstrapSession();
  if (user) {
    window.location.replace(homeForRole(user.role));
    return;
  }
  if (window.google?.accounts?.id) initGoogleButton();
  else window.addEventListener("load", initGoogleButton);

  initDevNote();
}

main();
