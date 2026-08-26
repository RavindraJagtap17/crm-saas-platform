import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { renderTable } from "../components/dataTable.js";
import { escapeHtml, formatDate, accountStatusBadge, errorState } from "../components/ui.js";

function columns() {
  return [
    { key: "name", label: "Agency", render: (t) => `<span class="table-cell-primary">${escapeHtml(t.name)}</span><div class="table-cell-muted text-xs">${escapeHtml(t.slug)}</div>` },
    { key: "status", label: "Status", render: (t) => accountStatusBadge(t.status) },
    { key: "limit", label: "Employee Limit", render: (t) => `<span class="num">${t.employeeLimit}</span>` },
    { key: "created", label: "Created", render: (t) => `<span class="text-secondary text-sm">${formatDate(t.createdAt)}</span>` },
  ];
}

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "overview", title: "Platform Overview" });

  content.innerHTML = `
    <div class="grid-stats mb-6" id="stats"></div>
    <div class="card">
      <div class="card-header"><h2 class="card-title">Tenants</h2></div>
      <div id="tenants-table"></div>
    </div>
  `;

  document.getElementById("stats").innerHTML = ["Total tenants", "Total users", "Total leads"]
    .map(() => `<div class="card stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-row" style="width:40%;height:28px"></div></div>`)
    .join("");

  try {
    const [overview, { tenants }] = await Promise.all([superAdminApi.overview(), superAdminApi.listTenants()]);

    document.getElementById("stats").innerHTML = `
      <div class="card stat-card"><span class="stat-label">Total Tenants</span><span class="stat-value">${overview.totalTenants}</span>
        <span class="stat-meta">${Object.entries(overview.tenantsByStatus).map(([s, c]) => `${c} ${s.replace("_", " ")}`).join(" · ") || "—"}</span></div>
      <div class="card stat-card"><span class="stat-label">Total Users</span><span class="stat-value">${overview.totalUsers}</span></div>
      <div class="card stat-card"><span class="stat-label">Total Leads</span><span class="stat-value">${overview.totalLeads}</span></div>
    `;

    renderTable(document.getElementById("tenants-table"), {
      columns: columns(),
      rows: tenants,
      onRowClick: (t) => (window.location.href = `./tenant.html?id=${t.id}`),
      empty: { icon: "◆", title: "No tenants yet", desc: "Agencies appear here once they sign up." },
    });
  } catch (err) {
    content.innerHTML = errorState({ desc: err.message });
    content.querySelector("[data-retry]")?.addEventListener("click", () => window.location.reload());
  }
}

main();
