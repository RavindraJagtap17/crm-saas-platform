import { GOOGLE_CLIENT_ID, homeForRole, bootstrapSession } from "../session.js";
import { authApi } from "../api/resources.js";

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
      showAlert(`${err.message} <a href="./signup.html">Create an agency</a> if you're starting a new one.`);
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

async function main() {
  // Already signed in? Skip straight to the right home page.
  const user = await bootstrapSession();
  if (user) {
    window.location.replace(homeForRole(user.role));
    return;
  }
  if (window.google?.accounts?.id) initGoogleButton();
  else window.addEventListener("load", initGoogleButton);
}

main();
