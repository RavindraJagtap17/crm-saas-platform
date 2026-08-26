import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { dashboardApi, leadsApi, leadStatusesApi } from "../api/resources.js";
import { escapeHtml, duplicateBadge, emptyState, errorState } from "../components/ui.js";

async function renderCallingList(container, statuses) {
  const finalStatusIds = new Set(statuses.filter((s) => s.is_final).map((s) => s.id));
  container.innerHTML = `<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row" style="width:70%"></div>`;
  try {
    const { items } = await leadsApi.list({ pageSize: 50 });
    const callingList = items.filter((l) => !finalStatusIds.has(l.statusId));
    if (!callingList.length) {
      container.innerHTML = emptyState({ icon: "☀", title: "You're all caught up", desc: "No open leads need your attention right now." });
      return;
    }
    const statusById = new Map(statuses.map((s) => [s.id, s]));
    container.innerHTML = `
      <ul class="flex-col gap-2">
        ${callingList
          .map((l) => {
            const status = statusById.get(l.statusId);
            return `
            <li>
              <a href="./lead-detail.html?id=${l.id}" class="card" style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3) var(--space-4);text-decoration:none">
                <span>
                  <span class="table-cell-primary">${escapeHtml(l.name || l.phone || "Untitled lead")}</span> ${duplicateBadge(l.isDuplicate)}
                  <div class="text-xs text-tertiary">${escapeHtml(l.phone || "")}</div>
                </span>
                ${status ? `<span class="status-pill"><span class="dot" style="background:${status.color || "#9aa1b3"}"></span>${escapeHtml(status.name)}</span>` : '<span class="text-tertiary text-xs">No status</span>'}
              </a>
            </li>`;
          })
          .join("")}
      </ul>`;
  } catch (err) {
    container.innerHTML = errorState({ desc: err.message });
  }
}

async function main() {
  const user = await requireRole("tenant_employee");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "dashboard", title: "Dashboard" });

  content.innerHTML = `
    <div class="grid-stats mb-6" id="stats"></div>
    <div class="card">
      <div class="card-header"><h2 class="card-title">Today's Calling List</h2><p class="card-subtitle">Your open leads, newest first.</p></div>
      <div class="card-body" id="calling-list"></div>
    </div>
  `;

  document.getElementById("stats").innerHTML = ["Assigned to you", "Calls this month"]
    .map(() => `<div class="card stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-row" style="width:40%;height:28px"></div></div>`)
    .join("");

  try {
    const [summary, statuses] = await Promise.all([dashboardApi.summary(), leadStatusesApi.list().then((r) => r.statuses)]);
    document.getElementById("stats").innerHTML = `
      <div class="card stat-card"><span class="stat-label">Assigned to you</span><span class="stat-value">${summary.totals.assigned}</span></div>
      <div class="card stat-card"><span class="stat-label">Calls this month</span><span class="stat-value">${summary.totals.callsThisMonth}</span></div>
    `;
    await renderCallingList(document.getElementById("calling-list"), statuses);
  } catch (err) {
    content.innerHTML = errorState({ desc: err.message });
  }
}

main();
