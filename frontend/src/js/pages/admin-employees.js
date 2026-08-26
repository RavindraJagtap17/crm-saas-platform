import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { usersApi, tenantApi } from "../api/resources.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, accountStatusBadge, roleLabel, formatDate, avatarHtml } from "../components/ui.js";

let tenant = null;

function seatsUsed(users) {
  return users.filter((u) => u.role === "tenant_employee" && (u.status === "active" || u.status === "invited")).length;
}

async function refresh(content) {
  const listEl = document.getElementById("employees-list");
  const seatEl = document.getElementById("seats-card");
  listEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;

  try {
    const [{ users }, tenantData] = await Promise.all([usersApi.list(), tenant ? Promise.resolve({ tenant }) : tenantApi.get()]);
    tenant = tenantData.tenant;
    const used = seatsUsed(users);
    const atLimit = used >= tenant.employeeLimit;

    seatEl.innerHTML = `
      <div class="stat-card" style="padding:0">
        <span class="stat-label">Employee Seats</span>
        <span class="stat-value">${used} <span class="text-tertiary" style="font-size:var(--text-lg)">/ ${tenant.employeeLimit}</span></span>
        <span class="stat-meta">${atLimit ? "Limit reached — ask your platform administrator to increase it." : "Includes invited and active employee accounts."}</span>
      </div>`;

    if (!users.length) {
      listEl.innerHTML = `<div class="card-body">${emptyState({ title: "No team members yet" })}</div>`;
      return;
    }

    listEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            ${users
              .map(
                (u) => `
              <tr>
                <td data-label="Name"><div class="flex items-center gap-2">${avatarHtml(u.name, "avatar-sm")}<div><div class="table-cell-primary">${escapeHtml(u.name)}</div><div class="table-cell-muted text-xs">${escapeHtml(u.email)}</div></div></div></td>
                <td data-label="Role">${roleLabel(u.role)}</td>
                <td data-label="Status">${accountStatusBadge(u.status)}</td>
                <td data-label="Joined">${formatDate(u.createdAt)}</td>
                <td data-label="">
                  ${
                    u.status === "deactivated"
                      ? `<button class="btn btn-secondary btn-sm" data-reactivate="${u.id}">Reactivate</button>`
                      : `<button class="btn btn-ghost btn-sm" data-deactivate="${u.id}">Deactivate</button>`
                  }
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;

    listEl.querySelectorAll("[data-deactivate]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Deactivate this account?",
          message: "They'll no longer be able to sign in. You can reactivate them later.",
          confirmLabel: "Deactivate",
          danger: true,
        });
        if (!ok) return;
        try {
          await usersApi.setStatus(btn.dataset.deactivate, "deactivated");
          toastSuccess("Account deactivated.");
          refresh(content);
        } catch (err) {
          toastError(err.message);
        }
      })
    );
    listEl.querySelectorAll("[data-reactivate]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await usersApi.setStatus(btn.dataset.reactivate, "active");
          toastSuccess("Account reactivated.");
          refresh(content);
        } catch (err) {
          toastError(err.message);
        }
      })
    );
  } catch (err) {
    listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load your team", desc: err.message })}</div>`;
  }
}

function openInviteForm(content) {
  openModal({
    title: "Invite a team member",
    bodyHtml: `
      <form id="invite-form" novalidate>
        <div class="field">
          <label class="label" for="inv-name">Name</label>
          <input class="input" id="inv-name" placeholder="Jane Doe" />
        </div>
        <div class="field">
          <label class="label" for="inv-email">Email</label>
          <input class="input" type="email" id="inv-email" placeholder="jane@agency.com" />
          <span class="hint">They'll sign in with this exact Google account.</span>
        </div>
        <div class="field">
          <label class="label" for="inv-role">Role</label>
          <select class="select" id="inv-role">
            <option value="tenant_employee">Employee</option>
            <option value="tenant_admin">Admin</option>
          </select>
        </div>
        <div class="field-error" id="inv-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="inv-submit">Send invite</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#inv-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#inv-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        try {
          await usersApi.invite({
            name: modalEl.querySelector("#inv-name").value.trim(),
            email: modalEl.querySelector("#inv-email").value.trim(),
            role: modalEl.querySelector("#inv-role").value,
          });
          closeFn();
          toastSuccess("Invite created — they can now sign in with Google using that email.");
          refresh(content);
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = err.message;
        } finally {
          setButtonLoading(btn, false);
        }
      });
    },
  });
}

async function main() {
  const user = await requireRole("tenant_admin");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "employees", title: "Employees" });

  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Employees</h2><p class="page-subtitle">Manage who has access to your workspace.</p></div>
      <button class="btn btn-primary" id="invite-btn">+ Invite</button>
    </div>
    <div class="card card-pad mb-4" id="seats-card"></div>
    <div class="card" id="employees-list"></div>
  `;
  document.getElementById("invite-btn").addEventListener("click", () => openInviteForm(content));
  await refresh(content);
}

main();
