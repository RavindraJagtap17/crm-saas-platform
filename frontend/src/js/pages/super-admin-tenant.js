import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { confirmDialog, openModal } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, formatDate, accountStatusBadge, setButtonLoading, emptyState } from "../components/ui.js";

const tenantId = new URLSearchParams(window.location.search).get("id");

// "Agency pays per Client" restructure: Agency signup is free and a fresh
// tenant now starts 'active' (see tenantModel.createTenant) — there is no
// subscription/payment concept left at the Agency level at all, so this is
// the ONLY lever Super Admin has over an agency's account status. Directly
// flips tenants.status via superAdminService.updateStatus.
// 'pending_payment' is kept only for any tenant already in that state from
// before this restructure shipped (the ENUM value itself is never removed —
// see tenantModel.createTenant's own comment).
const STATUS_ACTIONS = {
  pending_payment: [{ to: "active", label: "Activate", danger: false }],
  active: [{ to: "suspended", label: "Suspend", danger: true }],
  suspended: [
    { to: "active", label: "Reactivate", danger: false },
    { to: "canceled", label: "Cancel", danger: true },
  ],
  canceled: [{ to: "active", label: "Reactivate", danger: false }],
};

function openInviteAgencyAdminModal(onInvited) {
  openModal({
    title: "Invite Agency Admin",
    bodyHtml: `
      <form id="ia-form" novalidate>
        <div class="field">
          <label class="label" for="ia-name">Name</label>
          <input class="input" id="ia-name" placeholder="Jane Doe" />
        </div>
        <div class="field">
          <label class="label" for="ia-email">Email</label>
          <input class="input" type="email" id="ia-email" placeholder="jane@agency.com" />
          <span class="hint">They'll sign in with this exact Google account.</span>
        </div>
        <div class="field-error" id="ia-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="ia-submit">Send invite</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#ia-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#ia-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        try {
          await superAdminApi.inviteAgencyAdmin(tenantId, {
            name: modalEl.querySelector("#ia-name").value.trim(),
            email: modalEl.querySelector("#ia-email").value.trim(),
            role: "agency_admin",
          });
          closeFn();
          toastSuccess("Agency Admin invited.");
          onInvited();
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

async function render(content) {
  let data;
  try {
    data = await superAdminApi.getTenant(tenantId);
  } catch (err) {
    content.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load this agency", desc: err.message });
    return;
  }
  const { tenant, clientCount, clients, users } = data;

  content.innerHTML = `
    <a href="./index.html" class="text-sm">← All agencies</a>
    <div class="page-header mt-2">
      <div>
        <h2 class="page-title">${escapeHtml(tenant.name)}</h2>
        <p class="page-subtitle">${escapeHtml(tenant.slug)}</p>
      </div>
      ${accountStatusBadge(tenant.status)}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)">
      <div class="card">
        <div class="card-header"><h3 class="card-title">Agency Admins (${users.length})</h3><button class="btn btn-secondary btn-sm" id="invite-admin-btn">+ Invite Agency Admin</button></div>
        <div class="table-wrap" style="border:none;border-radius:0">
          ${
            users.length
              ? `<table class="data-table">
                  <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                  <tbody>
                    ${users
                      .map(
                        (u) => `<tr>
                          <td data-label="Name" class="table-cell-primary">${escapeHtml(u.name)}</td>
                          <td data-label="Email" class="table-cell-muted">${escapeHtml(u.email)}</td>
                          <td data-label="Status">${accountStatusBadge(u.status)}</td>
                        </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
              : `<div class="card-body">${emptyState({ title: "No Agency Admin invited yet" })}</div>`
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="card-title">Account Status</h3></div>
        <div class="card-body">
          <p class="text-sm mb-4">Agency signup is free — this is a manual override of the agency's account status.</p>
          <div class="flex gap-2" id="status-actions"></div>
        </div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-header"><h3 class="card-title">Clients (${clientCount})</h3></div>
      <div class="table-wrap" style="border:none;border-radius:0">
        ${
          clients.length
            ? `<table class="data-table">
                <thead><tr><th>Name</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>
                  ${clients
                    .map(
                      (c) => `<tr>
                        <td data-label="Name" class="table-cell-primary">${escapeHtml(c.name)}</td>
                        <td data-label="Status">${c.status === "active" ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
                        <td data-label="Created" class="text-secondary text-sm">${formatDate(c.created_at)}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>`
            : `<div class="card-body">${emptyState({ title: "No clients yet", desc: "The Agency Admin adds clients from their own Clients page." })}</div>`
        }
      </div>
    </div>
  `;

  document.getElementById("invite-admin-btn").addEventListener("click", () => openInviteAgencyAdminModal(() => render(content)));

  document.getElementById("status-actions").innerHTML = (STATUS_ACTIONS[tenant.status] || [])
    .map((a) => `<button class="btn ${a.danger ? "btn-danger" : "btn-primary"}" data-to="${a.to}">${a.label}</button>`)
    .join("");
  document.querySelectorAll("#status-actions [data-to]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const to = btn.dataset.to;
      const ok = await confirmDialog({
        title: `${btn.textContent} this agency?`,
        message: `This changes ${tenant.name}'s status to "${to}", which affects whether their clients can use the workspace.`,
        confirmLabel: btn.textContent,
        danger: btn.classList.contains("btn-danger"),
      });
      if (!ok) return;
      try {
        await superAdminApi.updateStatus(tenantId, to);
        toastSuccess(`Agency status set to ${to}.`);
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
  const content = mountShell({ activeKey: "overview", title: "Agency" });
  if (!content) return;
  if (!tenantId) {
    content.innerHTML = emptyState({ title: "No agency specified" });
    return;
  }
  await render(content);
}

main();
