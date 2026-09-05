import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { renderTable } from "../components/dataTable.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, formatDate, accountStatusBadge, errorState, setButtonLoading } from "../components/ui.js";

function columns() {
  return [
    { key: "name", label: "Agency", render: (t) => `<span class="table-cell-primary">${escapeHtml(t.name)}</span><div class="table-cell-muted text-xs">${escapeHtml(t.slug)}</div>` },
    { key: "status", label: "Status", render: (t) => accountStatusBadge(t.status) },
    { key: "created", label: "Created", render: (t) => `<span class="text-secondary text-sm">${formatDate(t.createdAt)}</span>` },
  ];
}

function openCreateAgencyModal(onCreated) {
  openModal({
    title: "Create agency",
    bodyHtml: `
      <form id="agency-form" novalidate>
        <div class="field">
          <label class="label" for="ag-name">Agency name</label>
          <input class="input" id="ag-name" placeholder="Acme Leads Co." />
        </div>
        <div class="field-error" id="ag-error" hidden></div>
        <p class="hint">This only creates the agency. Invite its first Agency Admin from the agency's detail page next.</p>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="ag-submit">Create agency</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#ag-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#ag-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        try {
          const { tenant } = await superAdminApi.createAgency(modalEl.querySelector("#ag-name").value.trim());
          closeFn();
          toastSuccess("Agency created.");
          window.location.href = `./tenant.html?id=${tenant.id}`;
          void onCreated;
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
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "overview", title: "Platform Overview" });
  if (!content) return;

  content.innerHTML = `
    <div class="grid-stats mb-6" id="stats"></div>
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Agencies</h2>
        <button class="btn btn-primary btn-sm" id="new-agency-btn">+ New Agency</button>
      </div>
      <div id="tenants-table"></div>
    </div>
  `;

  document.getElementById("new-agency-btn").addEventListener("click", () => openCreateAgencyModal());

  document.getElementById("stats").innerHTML = ["Total agencies", "Total clients", "Total users", "Total leads"]
    .map(() => `<div class="card stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-row" style="width:40%;height:28px"></div></div>`)
    .join("");

  try {
    const [overview, { tenants }] = await Promise.all([superAdminApi.overview(), superAdminApi.listTenants()]);

    document.getElementById("stats").innerHTML = `
      <div class="card stat-card"><span class="stat-label">Total Agencies</span><span class="stat-value">${overview.totalTenants}</span>
        <span class="stat-meta">${Object.entries(overview.tenantsByStatus).map(([s, c]) => `${c} ${s.replace("_", " ")}`).join(" · ") || "—"}</span></div>
      <div class="card stat-card"><span class="stat-label">Total Clients</span><span class="stat-value">${overview.totalClients}</span></div>
      <div class="card stat-card"><span class="stat-label">Total Users</span><span class="stat-value">${overview.totalUsers}</span></div>
      <div class="card stat-card"><span class="stat-label">Total Leads</span><span class="stat-value">${overview.totalLeads}</span></div>
    `;

    renderTable(document.getElementById("tenants-table"), {
      columns: columns(),
      rows: tenants,
      onRowClick: (t) => (window.location.href = `./tenant.html?id=${t.id}`),
      empty: { icon: "◆", title: "No agencies yet", desc: "Create one to get started." },
    });
  } catch (err) {
    content.innerHTML = errorState({ desc: err.message });
    content.querySelector("[data-retry]")?.addEventListener("click", () => window.location.reload());
  }
}

main();
