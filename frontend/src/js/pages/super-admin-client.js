import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { escapeHtml, formatDate, accountStatusBadge, licenseStatusBadge, formatDaysRemaining, emptyState } from "../components/ui.js";

const tenantId = new URLSearchParams(window.location.search).get("tenantId");
const clientId = new URLSearchParams(window.location.search).get("clientId");

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "overview", title: "Client" });
  if (!content) return;

  if (!tenantId || !clientId) {
    content.innerHTML = emptyState({ title: "No client specified" });
    return;
  }

  let client;
  try {
    client = await superAdminApi.getClient(tenantId, clientId);
  } catch (err) {
    content.innerHTML = emptyState({
      icon: "⚠",
      title: "Couldn't load this client",
      desc: err.status === 404 ? "This client doesn't exist under that Agency." : err.message,
    });
    return;
  }

  content.innerHTML = `
    <a href="./tenant.html?id=${client.tenantId}" class="text-sm">← ${escapeHtml(client.tenantName)}</a>
    <div class="page-header mt-2">
      <div>
        <h2 class="page-title">${escapeHtml(client.name)}</h2>
        <p class="page-subtitle">Client of ${escapeHtml(client.tenantName)}</p>
      </div>
      ${accountStatusBadge(client.status)}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)">
      <div class="card">
        <div class="card-header"><h3 class="card-title">Business Information</h3></div>
        <div class="card-body">
          <div class="field-row mb-4">
            <div><span class="label">Address</span><div class="mt-2">${client.address ? escapeHtml(client.address) : "—"}</div></div>
            <div><span class="label">City</span><div class="mt-2">${client.city ? escapeHtml(client.city) : "—"}</div></div>
          </div>
          <div class="field-row mb-4">
            <div><span class="label">GST Number</span><div class="mt-2">${client.gstNumber ? escapeHtml(client.gstNumber) : "—"}</div></div>
            <div><span class="label">Mobile</span><div class="mt-2">${client.mobile ? escapeHtml(client.mobile) : "—"}</div></div>
          </div>
          <div class="field-row">
            <div><span class="label">Contact Email</span><div class="mt-2">${client.contactEmail ? escapeHtml(client.contactEmail) : "—"}</div></div>
            <div><span class="label">Created</span><div class="mt-2">${formatDate(client.createdAt)}</div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="card-title">License</h3></div>
        <div class="card-body">
          <div class="field-row mb-4">
            <div><span class="label">Status</span><div class="mt-2">${licenseStatusBadge(client.license.status)}</div></div>
            <div><span class="label">Days Remaining</span><div class="mt-2">${formatDaysRemaining(client.license.daysRemaining)}</div></div>
          </div>
          <div class="field-row mb-4">
            <div><span class="label">Expires</span><div class="mt-2">${client.license.expiresAt ? formatDate(client.license.expiresAt) : "—"}</div></div>
          </div>
          <div class="divider"></div>
          <p class="text-xs text-tertiary mb-2">Current cycle only — not a payment history.</p>
          <div class="field-row">
            <div><span class="label">Razorpay Order</span><div class="mt-2 text-sm">${client.license.razorpayOrderId ? escapeHtml(client.license.razorpayOrderId) : "—"}</div></div>
            <div><span class="label">Razorpay Payment</span><div class="mt-2 text-sm">${client.license.razorpayPaymentId ? escapeHtml(client.license.razorpayPaymentId) : "—"}</div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-header"><h3 class="card-title">Client Admins (${client.admins.length})</h3></div>
      <div class="table-wrap" style="border:none;border-radius:0">
        ${
          client.admins.length
            ? `<table class="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                <tbody>
                  ${client.admins
                    .map(
                      (a) => `<tr>
                        <td data-label="Name" class="table-cell-primary">${escapeHtml(a.name)}</td>
                        <td data-label="Email" class="table-cell-muted">${escapeHtml(a.email)}</td>
                        <td data-label="Status">${accountStatusBadge(a.status)}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>`
            : `<div class="card-body">${emptyState({ title: "No Client Admin invited yet" })}</div>`
        }
      </div>
    </div>

    <div class="card mt-6 stat-card" style="max-width:280px">
      <span class="stat-label">Client Employees</span>
      <span class="stat-value">${client.employeeCount}</span>
    </div>
  `;
}

main();
