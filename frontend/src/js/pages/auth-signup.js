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
 * Google Identity Services' rendered button fires its callback the moment
 * an account is picked — it cannot be gated on a form field the way a
 * normal submit button can. So the Agency name is validated inside the
 * callback itself: an empty name shows an inline error and does not call
 * the API; the user fills it in and clicks the Google button again (a
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

function showNameError(message) {
  const errEl = document.getElementById("su-name-error");
  errEl.hidden = false;
  errEl.textContent = message;
}

function clearNameError() {
  document.getElementById("su-name-error").hidden = true;
}

async function handleCredentialResponse(response) {
  clearAlert();
  const name = document.getElementById("su-agency-name").value.trim();
  if (!name) {
    showNameError("Enter your agency's name first, then click the Google button again.");
    document.getElementById("su-agency-name").focus();
    return;
  }
  clearNameError();

  try {
    const { user } = await authApi.signup(response.credential, name);
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
