import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { agencyRazorpayApi } from "../api/resources.js";
import { confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatDateTime } from "../components/ui.js";

const STATUS_LABEL = { connected: "Connected", disconnected: "Not connected", pending: "Pending" };
const STATUS_BADGE = { connected: "badge-success", disconnected: "badge-neutral", pending: "badge-warning" };

async function startConnect(btn) {
  setButtonLoading(btn, true);
  try {
    const { authorizationUrl } = await agencyRazorpayApi.connect();
    // Full-page navigation to Razorpay's OAuth consent screen — the Bearer
    // token stayed in the Authorization header for the /connect call
    // above; it has no business being in this URL (see
    // agencyRazorpayConnect.controller.js).
    window.location.href = authorizationUrl;
  } catch (err) {
    toastError(err.message);
    setButtonLoading(btn, false);
  }
}

async function render(cardEl) {
  cardEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let connection;
  try {
    connection = await agencyRazorpayApi.connection();
  } catch (err) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load connection status", desc: err.message })}</div>`;
    return;
  }

  if (connection.status !== "connected") {
    cardEl.innerHTML = `
      <div class="card-body flex-col gap-4">
        ${emptyState({
          icon: "◈",
          title: "No Razorpay account connected",
          desc: "Connect your agency's own Razorpay account so your clients' subscription payments go directly to you, not the platform. This uses Razorpay's own secure sign-in — you never enter any API keys here.",
        })}
        <button class="btn btn-primary" id="connect-btn">Connect Razorpay</button>
      </div>`;
    cardEl.querySelector("#connect-btn").addEventListener("click", (e) => startConnect(e.currentTarget));
    return;
  }

  cardEl.innerHTML = `
    <div class="card-body flex-col gap-4">
      <div class="field-row">
        <div>
          <span class="label">Razorpay account</span>
          <p class="num">${escapeHtml(connection.razorpayAccountId)}</p>
        </div>
        <div>
          <span class="label">Connected</span>
          <p>${connection.connectedAt ? formatDateTime(connection.connectedAt) : "—"}</p>
        </div>
        <div>
          <span class="label">Status</span>
          <p><span class="badge ${STATUS_BADGE[connection.status] || "badge-neutral"}">${STATUS_LABEL[connection.status] || connection.status}</span></p>
        </div>
      </div>
      <div class="flex gap-3">
        <button class="btn btn-secondary" id="disconnect-btn">Disconnect</button>
      </div>
    </div>`;

  cardEl.querySelector("#disconnect-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Disconnect Razorpay account?",
      message: "This only removes the connection from this CRM — it does not affect your Razorpay account itself. Client subscription payments will stop working until you reconnect.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    try {
      await agencyRazorpayApi.disconnect();
      toastSuccess("Razorpay account disconnected.");
      await render(cardEl);
    } catch (err) {
      toastError(err.message);
    }
  });
}

async function main() {
  const user = await requireRole("agency_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "razorpay-connect", title: "Razorpay Account" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Razorpay Account</h2>
        <p class="page-subtitle">Connect your own Razorpay account so your clients pay you directly.</p>
      </div>
    </div>
    <div class="card" id="connection-card"></div>
  `;

  // The OAuth callback (agencyRazorpayConnect.controller.js oauthCallback)
  // redirects the browser back here with ?connected=true or ?error=...
  // since it can't hand results back any other way — surface it once,
  // then strip the query string so a reload doesn't re-show a stale toast.
  const params = new URLSearchParams(window.location.search);
  if (params.get("connected") === "true") {
    toastSuccess("Razorpay account connected.");
    history.replaceState(null, "", window.location.pathname);
  } else if (params.get("error")) {
    toastError(`Razorpay connection failed: ${params.get("error")}`);
    history.replaceState(null, "", window.location.pathname);
  }

  await render(document.getElementById("connection-card"));
}

main();
