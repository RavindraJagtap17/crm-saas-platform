import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, formatDate, accountStatusBadge, roleLabel, setButtonLoading, emptyState } from "../components/ui.js";

const tenantId = new URLSearchParams(window.location.search).get("id");

const STATUS_ACTIONS = {
  pending_payment: [{ to: "active", label: "Activate", danger: false }],
  active: [{ to: "suspended", label: "Suspend", danger: true }],
  suspended: [
    { to: "active", label: "Reactivate", danger: false },
    { to: "canceled", label: "Cancel", danger: true },
  ],
  canceled: [{ to: "active", label: "Reactivate", danger: false }],
};

async function render(content) {
  let data;
  try {
    data = await superAdminApi.getTenant(tenantId);
  } catch (err) {
    content.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load this tenant", desc: err.message });
    return;
  }
  const { tenant, employeeSeatsUsed, users } = data;

  content.innerHTML = `
    <a href="./index.html" class="text-sm">← All tenants</a>
    <div class="page-header mt-2">
      <div>
        <h2 class="page-title">${escapeHtml(tenant.name)}</h2>
        <p class="page-subtitle">${escapeHtml(tenant.slug)}</p>
      </div>
      ${accountStatusBadge(tenant.status)}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)">
      <div class="card">
        <div class="card-header"><h3 class="card-title">Employee limit</h3></div>
        <div class="card-body">
          <p class="text-sm mb-4">${employeeSeatsUsed} of <strong class="num">${tenant.employeeLimit}</strong> employee seats used.</p>
          <div class="field-row" style="align-items:end">
            <div class="field" style="margin-bottom:0">
              <label class="label" for="limit-input">New limit</label>
              <input class="input" type="number" min="0" id="limit-input" value="${tenant.employeeLimit}" />
            </div>
            <button class="btn btn-secondary" id="limit-save">Update limit</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="card-title">Subscription status</h3></div>
        <div class="card-body">
          <p class="text-sm mb-4">No Razorpay subscription data exists yet (later phase) — this changes the tenant's
            account status directly, which is what currently gates access to the workspace.</p>
          <div class="flex gap-2" id="status-actions">
            ${(STATUS_ACTIONS[tenant.status] || [])
              .map((a) => `<button class="btn ${a.danger ? "btn-danger" : "btn-primary"}" data-to="${a.to}">${a.label}</button>`)
              .join("")}
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-header"><h3 class="card-title">Team (${users.length})</h3></div>
      <div class="table-wrap" style="border:none;border-radius:0">
        ${
          users.length
            ? `<table class="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
                <tbody>
                  ${users
                    .map(
                      (u) => `<tr>
                        <td data-label="Name" class="table-cell-primary">${escapeHtml(u.name)}</td>
                        <td data-label="Email" class="table-cell-muted">${escapeHtml(u.email)}</td>
                        <td data-label="Role">${roleLabel(u.role)}</td>
                        <td data-label="Status">${accountStatusBadge(u.status)}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>`
            : `<div class="card-body">${emptyState({ title: "No team members yet" })}</div>`
        }
      </div>
    </div>
  `;

  document.getElementById("limit-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const value = Number(document.getElementById("limit-input").value);
    if (!Number.isInteger(value) || value < 0) return toastError("Enter a valid non-negative number.");
    setButtonLoading(btn, true);
    try {
      await superAdminApi.updateEmployeeLimit(tenantId, value);
      toastSuccess("Employee limit updated.");
      render(content);
    } catch (err) {
      toastError(err.message);
    } finally {
      setButtonLoading(btn, false);
    }
  });

  document.querySelectorAll("#status-actions [data-to]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const to = btn.dataset.to;
      const ok = await confirmDialog({
        title: `${btn.textContent} this tenant?`,
        message: `This changes ${tenant.name}'s status to "${to}", which affects whether their team can use the workspace.`,
        confirmLabel: btn.textContent,
        danger: btn.classList.contains("btn-danger"),
      });
      if (!ok) return;
      try {
        await superAdminApi.updateStatus(tenantId, to);
        toastSuccess(`Tenant status set to ${to}.`);
        render(content);
      } catch (err) {
        toastError(err.message);
      }
    })
  );
}

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "overview", title: "Tenant" });
  if (!tenantId) {
    content.innerHTML = emptyState({ title: "No tenant specified" });
    return;
  }
  await render(content);
}

main();
