import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { dashboardApi } from "../api/resources.js";
import { errorState, skeletonRows, formatMonthLabel } from "../components/ui.js";
import { barListHtml, columnChartSvg } from "../components/chart.js";

async function loadAndRender(content) {
  content.innerHTML = `
    <div class="grid-stats mb-4">
      ${["Total leads", "Unassigned", "Duplicates flagged"].map(() => `<div class="card stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-row" style="width:40%;height:28px"></div></div>`).join("")}
    </div>
    <div class="card"><div class="card-body">${skeletonRows(4)}</div></div>
  `;

  let data;
  try {
    data = await dashboardApi.summary();
  } catch (err) {
    content.innerHTML = errorState({ desc: err.message });
    content.querySelector("[data-retry]")?.addEventListener("click", () => loadAndRender(content));
    return;
  }

  const { totals, sourceBreakdown, monthlyVolume, statusBreakdown } = data;

  content.innerHTML = `
    <div class="grid-stats mb-6">
      <div class="card stat-card">
        <span class="stat-label">Total Leads</span>
        <span class="stat-value">${totals.total}</span>
      </div>
      <div class="card stat-card">
        <span class="stat-label">Unassigned</span>
        <span class="stat-value">${totals.unassigned}</span>
        <span class="stat-meta">Waiting to be assigned</span>
      </div>
      <div class="card stat-card">
        <span class="stat-label">Duplicates Flagged</span>
        <span class="stat-value">${totals.duplicates}</span>
      </div>
    </div>

    <div class="flex-col gap-6" style="display:grid;grid-template-columns:1.1fr 1fr;gap:var(--space-6)">
      <div class="card">
        <div class="card-header"><h2 class="card-title">Monthly Lead Volume</h2></div>
        <div class="card-body scroll-x">
          ${
            monthlyVolume.length
              ? columnChartSvg(monthlyVolume.map((m) => ({ label: formatMonthLabel(m.month), count: m.count })), {
                  labelKey: "label",
                  valueKey: "count",
                })
              : `<p class="text-secondary">No leads yet — volume will appear here once leads start coming in.</p>`
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2 class="card-title">Source Breakdown</h2></div>
        <div class="card-body">
          ${
            sourceBreakdown.filter((s) => s.count > 0).length
              ? barListHtml(sourceBreakdown.filter((s) => s.count > 0), { labelKey: "name", valueKey: "count" })
              : `<p class="text-secondary">No leads tagged with a source yet.</p>`
          }
        </div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-header"><h2 class="card-title">Pipeline by Status</h2></div>
      <div class="card-body">
        ${
          statusBreakdown.length
            ? `<div class="flex gap-3" style="flex-wrap:wrap">${statusBreakdown
                .map(
                  (s) => `<div class="badge badge-neutral" style="height:auto;padding:var(--space-2) var(--space-3)">
                    ${s.name}${s.isFinal ? " ·" : ""} <strong class="num">&nbsp;${s.count}</strong>
                  </div>`
                )
                .join("")}</div>`
            : `<p class="text-secondary">No lead statuses configured yet. <a href="./statuses.html">Set up your pipeline</a>.</p>`
        }
      </div>
    </div>
  `;
}

async function main() {
  const user = await requireRole("tenant_admin");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "dashboard", title: "Dashboard" });
  await loadAndRender(content);
}

main();
