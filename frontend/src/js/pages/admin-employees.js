import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { usersApi } from "../api/resources.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, accountStatusBadge, roleLabel, formatDate, avatarHtml } from "../components/ui.js";

async function refresh(content) {
  const listEl = document.getElementById("employees-list");
  const invitationsEl = document.getElementById("invitations-list");
  listEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;

  let users, invitations;
  try {
    ({ users, invitations } = await usersApi.list());
  } catch (err) {
    listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load your team", desc: err.message })}</div>`;
    return;
  }

  // Pending invitations — a real invitation entity now (employee_invitations),
  // shown separately from the roster table below rather than as a
  // status badge on a user row.
  if (invitations.length) {
    invitationsEl.hidden = false;
    invitationsEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Invited</th><th></th></tr></thead>
          <tbody>
            ${invitations
              .map(
                (inv) => `
              <tr>
                <td data-label="Name">${escapeHtml(inv.name)}</td>
                <td data-label="Email">${escapeHtml(inv.email)}</td>
                <td data-label="Invited">${formatDate(inv.createdAt)}</td>
                <td data-label=""><button class="btn btn-ghost btn-sm" data-cancel-invite="${inv.id}">Cancel</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
    invitationsEl.querySelectorAll("[data-cancel-invite]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Cancel this invitation?",
          message: "This immediately frees up the seat it was reserving.",
          confirmLabel: "Cancel invitation",
          danger: true,
        });
        if (!ok) return;
        setButtonLoading(btn, true);
        try {
          await usersApi.cancelInvitation(btn.dataset.cancelInvite);
          toastSuccess("Invitation cancelled.");
          refresh(content);
        } catch (err) {
          toastError(err.message);
          setButtonLoading(btn, false);
        }
      })
    );
  } else {
    invitationsEl.hidden = true;
    invitationsEl.innerHTML = "";
  }

  // Roster table — active/deactivated employees only; a pending invitation
  // is no longer shown here (see the section above), avoiding the same
  // "invited" person appearing twice with two different action sets.
  const roster = users.filter((u) => u.status !== "invited");
  document.getElementById("employee-count").textContent = String(roster.filter((u) => u.status === "active").length);

  if (!roster.length) {
    listEl.innerHTML = `<div class="card-body">${emptyState({ title: "No team members yet" })}</div>`;
    return;
  }

  listEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            ${roster
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
                      : u.role === "client_employee"
                        ? `<button class="btn btn-ghost btn-sm" data-deactivate="${u.id}">Deactivate</button>`
                        : ""
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
      setButtonLoading(btn, true);
      try {
        await usersApi.setStatus(btn.dataset.reactivate, "active");
        toastSuccess("Account reactivated.");
        refresh(content);
      } catch (err) {
        toastError(err.message);
        setButtonLoading(btn, false);
      }
    })
  );
}

function openInviteForm(content) {
  openModal({
    title: "Invite an employee",
    bodyHtml: `
      <form id="invite-form" novalidate>
        <div class="field">
          <label class="label" for="inv-name">Name</label>
          <input class="input" id="inv-name" placeholder="Jane Doe" />
        </div>
        <div class="field">
          <label class="label" for="inv-email">Email</label>
          <input class="input" type="email" id="inv-email" placeholder="jane@client-company.com" />
          <span class="hint">They'll sign in with this exact Google account.</span>
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
            // Only role a Client Admin may invite — a co-Client-Admin is
            // provisioned by the Agency Admin instead (see agency/clients.js).
            role: "client_employee",
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
  const user = await requireRole("client_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "employees", title: "Employees" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Employees</h2><p class="page-subtitle"><span id="employee-count">0</span> active team member(s)</p></div>
      <button class="btn btn-primary" id="invite-btn">+ Invite</button>
    </div>
    <div class="card mb-4" id="invitations-list" hidden></div>
    <div class="card" id="employees-list"></div>
  `;
  document.getElementById("invite-btn").addEventListener("click", () => openInviteForm(content));
  await refresh(content);
}

main();
