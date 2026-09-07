import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { renderTable } from "../components/dataTable.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, formatDate, accountStatusBadge, errorState, setButtonLoading } from "../components/ui.js";

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "pending_payment", label: "Pending payment" },
  { value: "canceled", label: "Canceled" },
];

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

function renderRecentAgencies(container, recentAgencies) {
  if (!recentAgencies.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <div class="card mb-6">
      <div class="card-header"><h2 class="card-title">Recent Agencies</h2></div>
      <div class="card-body" style="padding:0">
        <ul class="flex-col">
          ${recentAgencies
            .map(
              (t) => `
            <li>
              <a href="./tenant.html?id=${t.id}" style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3) var(--space-4);text-decoration:none;border-bottom:1px solid var(--border-subtle)">
                <span><span class="table-cell-primary">${escapeHtml(t.name)}</span> <span class="text-tertiary text-xs">${formatDate(t.createdAt)}</span></span>
                ${accountStatusBadge(t.status)}
              </a>
            </li>`
            )
            .join("")}
        </ul>
      </div>
    </div>`;
}

// Server-side search/filter (§2) — every keystroke/selection re-fetches
// GET /api/super-admin/tenants?q=&status= rather than filtering a
// client-held list, so the list stays correct as agencies are added and
// never over-fetches. Debounced on the text input only; the status
// dropdown re-fetches immediately on change.
function wireSearchAndFilter(tableEl) {
  const qInput = document.getElementById("agency-search");
  const statusSelect = document.getElementById("agency-status-filter");
  let debounceTimer = null;

  async function refetch() {
    renderTable(tableEl, { columns: columns(), rows: null });
    try {
      const { tenants } = await superAdminApi.listTenants({ q: qInput.value.trim() || undefined, status: statusSelect.value || undefined });
      renderTable(tableEl, {
        columns: columns(),
        rows: tenants,
        onRowClick: (t) => (window.location.href = `./tenant.html?id=${t.id}`),
        empty: { icon: "◆", title: "No agencies match", desc: "Try a different search or filter." },
      });
    } catch (err) {
      tableEl.innerHTML = errorState({ desc: err.message });
    }
  }

  qInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refetch, 300);
  });
  statusSelect.addEventListener("change", refetch);

  return refetch;
}

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "overview", title: "Platform Overview" });
  if (!content) return;

  content.innerHTML = `
    <div class="grid-stats mb-6" id="stats"></div>
    <div id="recent-agencies"></div>
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Agencies</h2>
        <button class="btn btn-primary btn-sm" id="new-agency-btn">+ New Agency</button>
      </div>
      <div class="card-body flex-row gap-3" style="flex-wrap:wrap;padding-bottom:0">
        <input class="input" id="agency-search" placeholder="Search by name, email, mobile, or GST…" style="flex:1;min-width:220px" />
        <select class="select" id="agency-status-filter" style="width:auto">
          ${STATUS_FILTER_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
        </select>
      </div>
      <div id="tenants-table"></div>
    </div>
  `;

  document.getElementById("new-agency-btn").addEventListener("click", () => openCreateAgencyModal());

  document.getElementById("stats").innerHTML = Array(8)
    .fill(0)
    .map(() => `<div class="card stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-row" style="width:40%;height:28px"></div></div>`)
    .join("");
  renderTable(document.getElementById("tenants-table"), { columns: columns(), rows: null });

  try {
    const overview = await superAdminApi.overview();

    document.getElementById("stats").innerHTML = `
      <div class="card stat-card"><span class="stat-label">Total Agencies</span><span class="stat-value">${overview.totalTenants}</span>
        <span class="stat-meta">${Object.entries(overview.tenantsByStatus).map(([s, c]) => `${c} ${s.replace("_", " ")}`).join(" · ") || "—"}</span></div>
      <div class="card stat-card"><span class="stat-label">Total Clients</span><span class="stat-value">${overview.totalClients}</span>
        <span class="stat-meta">${overview.activeClients} active</span></div>
      <div class="card stat-card"><span class="stat-label">Total Users</span><span class="stat-value">${overview.totalUsers}</span></div>
      <div class="card stat-card"><span class="stat-label">Total Leads</span><span class="stat-value">${overview.totalLeads}</span></div>
      <div class="card stat-card"><span class="stat-label">Active Licenses</span><span class="stat-value">${overview.clientLicenses.active}</span></div>
      <div class="card stat-card"><span class="stat-label">Expiring Soon</span><span class="stat-value">${overview.clientLicenses.expiringSoon}</span><span class="stat-meta">Within 30 days</span></div>
      <div class="card stat-card"><span class="stat-label">Expired Licenses</span><span class="stat-value">${overview.clientLicenses.expired}</span></div>
      <div class="card stat-card"><span class="stat-label">Pending Licenses</span><span class="stat-value">${overview.clientLicenses.pending}</span></div>
    `;

    renderRecentAgencies(document.getElementById("recent-agencies"), overview.recentAgencies);

    const tableEl = document.getElementById("tenants-table");
    const refetch = wireSearchAndFilter(tableEl);
    await refetch();
  } catch (err) {
    content.innerHTML = errorState({ desc: err.message });
    content.querySelector("[data-retry]")?.addEventListener("click", () => window.location.reload());
  }
}

main();
