import { GOOGLE_CLIENT_ID, homeForRole } from "../session.js";
import { authApi } from "../api/resources.js";

function isPlaceholder(id) {
  return !id || id.startsWith("PLACEHOLDER");
}
function showAlert(html, type = "danger") {
  document.getElementById("alert-slot").innerHTML = `<div class="alert alert-${type}" role="alert">${html}</div>`;
}
function fieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  field.classList.toggle("has-error", !!message);
  const err = field.querySelector(".field-error");
  err.hidden = !message;
  err.textContent = message || "";
}

async function handleCredentialResponse(response) {
  const agencyName = document.getElementById("agencyName").value.trim();
  if (!agencyName) {
    fieldError("agency-field", "Enter your agency name before continuing with Google.");
    document.getElementById("agencyName").focus();
    return;
  }
  fieldError("agency-field", "");

  try {
    const { user } = await authApi.signup(response.credential, agencyName);
    window.location.href = homeForRole(user.role);
  } catch (err) {
    if (err.code === "ACCOUNT_EXISTS") {
      showAlert(`${err.message} <a href="./index.html">Sign in instead</a>.`);
    } else {
      showAlert(err.message || "Could not create your agency. Please try again.");
    }
  }
}

function initGoogleButton() {
  if (isPlaceholder(GOOGLE_CLIENT_ID)) {
    document.getElementById("gsi-button").innerHTML =
      '<p class="hint" style="text-align:center">Google Sign-In isn\'t configured for this environment yet.</p>';
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

if (window.google?.accounts?.id) initGoogleButton();
else window.addEventListener("load", initGoogleButton);
