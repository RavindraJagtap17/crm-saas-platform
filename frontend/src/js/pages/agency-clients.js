import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { clientsApi } from "../api/resources.js";
import { renderTable } from "../components/dataTable.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, formatDate, emptyState, setButtonLoading } from "../components/ui.js";

let state = { clients: [], limit: null };

/**
 * The effective client limit is ALWAYS the number GET /api/clients/limit
 * returns — never recomputed here from a plan's advertised features or
 * any other client-side guess. null = unlimited; 0 can only mean "no
 * active subscription" (a real plan's max_clients is either a positive
 * integer or null — see backend/src/validators/billingValidators.js).
 */
function formatLimitSummary(count, limit) {
  if (limit === 0) return { text: "0 available — no active subscription", over: false, blocked: true };
  if (limit === null) return { text: `${count} client${count === 1 ? "" : "s"} · Unlimited`, over: false, blocked: false };
  const over = count > limit;
  return {
    text: `${count} / ${limit} client${limit === 1 ? "" : "s"}${over ? " — Over plan limit" : ""}`,
    over,
    blocked: count >= limit,
  };
}

function statusBadge(status) {
  return status === "active" ? `<span class="badge badge-success">Active</span>` : `<span class="badge badge-neutral">Inactive</span>`;
}

function columns() {
  return [
    { key: "name", label: "Client", render: (c) => `<span class="table-cell-primary">${escapeHtml(c.name)}</span>` },
    { key: "status", label: "Status", render: (c) => statusBadge(c.status) },
    { key: "created", label: "Created", render: (c) => `<span class="text-secondary text-sm">${formatDate(c.createdAt)}</span>` },
    {
      key: "actions",
      label: "",
      render: (c) =>
        c.status === "active"
          ? `<button class="btn btn-ghost btn-sm" data-deactivate="${c.id}">Deactivate</button>`
          : `<button class="btn btn-secondary btn-sm" data-activate="${c.id}">Activate</button>`,
    },
  ];
}

async function refresh(content) {
  const tableEl = document.getElementById("clients-table");
  const summaryEl = document.getElementById("limit-summary");
  const addBtn = document.getElementById("add-client-btn");
  renderTable(tableEl, { columns: columns(), rows: null });

  let clients, limit;
  try {
    [{ clients }, { maxClients: limit }] = await Promise.all([clientsApi.list(), clientsApi.limit()]);
  } catch (err) {
    tableEl.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load clients", desc: err.message });
    return;
  }
  state = { clients, limit };

  const summary = formatLimitSummary(clients.length, limit);
  summaryEl.innerHTML = `
    <div class="stat-card" style="padding:0">
      <span class="stat-label">Clients</span>
      <span class="stat-value" style="font-size:1.25rem">${escapeHtml(summary.text)}</span>
    </div>
    ${
      summary.over
        ? `<div class="alert alert-warning mt-3"><span>⚠</span><span>You're over your plan's client limit. Existing clients are kept — upgrade your plan or deactivate a client to add another.</span></div>`
        : ""
    }
    ${
      limit === 0
        ? `<div class="alert alert-warning mt-3"><span>⚠</span><span>Subscribe to a plan on the <a href="./billing.html">Billing</a> page before adding clients.</span></div>`
        : ""
    }
  `;

  addBtn.disabled = summary.blocked;
  addBtn.title = summary.blocked ? "You've reached your plan's client limit." : "";

  if (!clients.length) {
    tableEl.innerHTML = emptyState({
      icon: "◎",
      title: "No clients yet",
      desc: "Add your first client to start managing their leads.",
    });
    return;
  }

  renderTable(tableEl, { columns: columns(), rows: clients });

  tableEl.querySelectorAll("[data-deactivate]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Deactivate this client?",
        message: "Its Client Admin and employees will lose access to the CRM until you reactivate it.",
        confirmLabel: "Deactivate",
        danger: true,
      });
      if (!ok) return;
      try {
        await clientsApi.setStatus(btn.dataset.deactivate, "inactive");
        toastSuccess("Client deactivated.");
        refresh(content);
      } catch (err) {
        toastError(err.message);
      }
    })
  );
  tableEl.querySelectorAll("[data-activate]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await clientsApi.setStatus(btn.dataset.activate, "active");
        toastSuccess("Client activated.");
        refresh(content);
      } catch (err) {
        toastError(err.message);
      }
    })
  );
}

/**
 * §Client creation flow: Clients -> Add Client -> Client details -> Invite
 * Client Admin -> Client created. Creating the client and inviting its
 * first Client Admin are two separate API calls (mirrors how a Super
 * Admin creates an agency, then separately invites its first Agency
 * Admin) — an "Invite later" skip is offered since the client itself
 * already exists as soon as the first step succeeds.
 */
function openInviteAdminStep(content, client) {
  openModal({
    title: `Invite the Client Admin for ${client.name}`,
    bodyHtml: `
      <p class="text-sm text-secondary mb-4">${escapeHtml(client.name)} was created. Invite its first Client Admin now, or skip and do this later.</p>
      <form id="invite-admin-form" novalidate>
        <div class="field">
          <label class="label" for="ia-name">Name</label>
          <input class="input" id="ia-name" placeholder="Jane Doe" />
        </div>
        <div class="field">
          <label class="label" for="ia-email">Email</label>
          <input class="input" type="email" id="ia-email" placeholder="jane@client-company.com" />
          <span class="hint">They'll sign in with this exact Google account.</span>
        </div>
        <div class="field-error" id="ia-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Skip for now</button><button class="btn btn-primary" id="ia-submit">Send invite</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", () => {
        closeFn();
        refresh(content);
      });
      modalEl.querySelector("#ia-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#ia-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        try {
          await clientsApi.inviteAdmin(client.id, {
            name: modalEl.querySelector("#ia-name").value.trim(),
            email: modalEl.querySelector("#ia-email").value.trim(),
            role: "client_admin",
          });
          closeFn();
          toastSuccess("Client Admin invited — they can now sign in with Google using that email.");
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

function openCreateClientModal(content) {
  openModal({
    title: "Add client",
    bodyHtml: `
      <form id="client-form" novalidate>
        <div class="field">
          <label class="label" for="c-name">Client name</label>
          <input class="input" id="c-name" placeholder="Acme Retail Co." />
        </div>
        <div class="field-error" id="c-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="c-submit">Create client</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#c-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#c-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        try {
          const { client } = await clientsApi.create({ name: modalEl.querySelector("#c-name").value.trim() });
          closeFn();
          toastSuccess("Client created.");
          openInviteAdminStep(content, client);
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
  const user = await requireRole("agency_admin");
  if (!user) return;
  // mountShell() first: it renders the sidebar's [data-tenant-name]/
  // [data-tenant-logo] placeholders into the DOM, which applyTenantBranding()
  // then fills in — calling it the other way around means those elements
  // don't exist yet and the fetched branding has nothing to attach to.
  const content = mountShell({ activeKey: "clients", title: "Clients" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Clients</h2>
        <p class="page-subtitle">The businesses your agency manages leads for.</p>
      </div>
      <button class="btn btn-primary" id="add-client-btn">+ Add Client</button>
    </div>
    <div class="card card-pad mb-4" id="limit-summary"></div>
    <div id="clients-table"></div>
  `;

  document.getElementById("add-client-btn").addEventListener("click", () => openCreateClientModal(content));
  await refresh(content);
}

main();
