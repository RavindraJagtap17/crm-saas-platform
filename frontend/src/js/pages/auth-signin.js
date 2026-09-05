import { GOOGLE_CLIENT_ID, homeForRole, bootstrapSession, isDevBackend } from "../session.js";
import { authApi } from "../api/resources.js";
import { escapeHtml } from "../components/ui.js";

function isPlaceholder(id) {
  return !id || id.startsWith("PLACEHOLDER");
}

function showAlert(html, type = "danger") {
  document.getElementById("alert-slot").innerHTML = `<div class="alert alert-${type}" role="alert">${html}</div>`;
}

async function handleCredentialResponse(response) {
  try {
    const { user } = await authApi.google(response.credential);
    window.location.href = homeForRole(user.role);
  } catch (err) {
    if (err.code === "ACCOUNT_NOT_FOUND") {
      showAlert(`${err.message}`);
    } else if (err.code === "ACCOUNT_DEACTIVATED") {
      showAlert(err.message);
    } else {
      showAlert(err.message || "Sign-in failed. Please try again.");
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
    text: "signin_with",
  });
}

const DEV_ROLES = [
  { role: "super_admin", label: "Super Admin" },
  { role: "agency_admin_test101", label: "Agency Admin — Test Agency 101" },
  { role: "client_admin_test101", label: "Client Admin — Test Client A1" },
  { role: "client_employee_test101", label: "Client Employee — Test Client A1" },
];

/**
 * Development-only convenience panel — only ever rendered after
 * isDevBackend() confirms the backend's dev-login route actually exists
 * (absent entirely when NODE_ENV=production, see session.js). Signs in
 * via the exact same session-issuing path as Google Sign-In, just without
 * a real Google round trip, using the pre-seeded local test accounts
 * (backend/scripts/seedDevAuth.js).
 */
async function initDevLoginPanel() {
  const isDev = await isDevBackend();
  if (!isDev) return;

  const slot = document.getElementById("dev-login-slot");
  slot.innerHTML = `
    <div class="card card-pad mt-4" style="border-style:dashed">
      <p class="text-xs text-tertiary font-semibold mb-3">DEVELOPMENT SIGN-IN — not available in production</p>
      <div class="flex-col gap-2" id="dev-login-buttons"></div>
    </div>`;

  const buttonsEl = slot.querySelector("#dev-login-buttons");
  buttonsEl.innerHTML = DEV_ROLES.map(
    (r) => `<button class="btn btn-secondary btn-sm w-full" data-dev-role="${r.role}">Sign in as ${escapeHtml(r.label)}</button>`
  ).join("");

  buttonsEl.querySelectorAll("[data-dev-role]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const { user } = await authApi.devLogin(btn.dataset.devRole);
        window.location.href = homeForRole(user.role);
      } catch (err) {
        showAlert(err.message || "Dev sign-in failed. Have you run backend/scripts/seedDevAuth.js?");
        btn.disabled = false;
      }
    });
  });
}

async function main() {
  // Already signed in? Skip straight to the right home page.
  const user = await bootstrapSession();
  if (user) {
    window.location.replace(homeForRole(user.role));
    return;
  }
  if (window.google?.accounts?.id) initGoogleButton();
  else window.addEventListener("load", initGoogleButton);

  initDevLoginPanel();
}

main();
