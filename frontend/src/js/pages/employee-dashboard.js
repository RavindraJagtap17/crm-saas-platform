import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { dashboardApi, leadsApi, leadStatusesApi } from "../api/resources.js";
import { escapeHtml, duplicateBadge, emptyState, errorState, skeletonRows } from "../components/ui.js";

async function renderCallingList(container, statuses, userId) {
  const finalStatusIds = new Set(statuses.filter((s) => s.is_final).map((s) => s.id));
  container.innerHTML = `<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row" style="width:70%"></div>`;
  try {
    // assignedTo is a plain, already-existing GET /api/leads filter (any
    // role may pass it) — scoping the calling list to the employee's own
    // leads here is a dashboard-widget choice, not a change to the
    // broader "employee can see every client lead" visibility rule, which
    // still governs the Leads page itself.
    const { items } = await leadsApi.list({ pageSize: 100, assignedTo: userId });
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
  const user = await requireRole("client_employee");
  if (!user) return;
  const content = mountShell({ activeKey: "dashboard", title: "Dashboard" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="grid-stats mb-6" id="stats"></div>
    <div class="card mb-6">
      <div class="card-header"><h2 class="card-title">My Leads by Status</h2><p class="card-subtitle">Only leads assigned to you.</p></div>
      <div class="card-body" id="my-status-breakdown"></div>
    </div>
    <div class="card">
      <div class="card-header"><h2 class="card-title">Today's Calling List</h2><p class="card-subtitle">Your open leads, newest first.</p></div>
      <div class="card-body" id="calling-list"></div>
    </div>
  `;

  document.getElementById("stats").innerHTML = ["Assigned to you", "Today's calls", "Today's follow-ups", "Overdue", "Upcoming", "Completed today"]
    .map(() => `<div class="card stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-row" style="width:40%;height:28px"></div></div>`)
    .join("");
  document.getElementById("my-status-breakdown").innerHTML = skeletonRows(2);

  try {
    const [summary, statuses] = await Promise.all([dashboardApi.summary(), leadStatusesApi.list().then((r) => r.statuses)]);
    const { followUps } = summary;
    document.getElementById("stats").innerHTML = `
      <div class="card stat-card"><span class="stat-label">Assigned to you</span><span class="stat-value">${summary.totals.assigned}</span></div>
      <div class="card stat-card"><span class="stat-label">Today's Calls</span><span class="stat-value">${summary.totals.callsToday}</span><span class="stat-meta">${summary.totals.callsThisMonth} this month</span></div>
      <div class="card stat-card"><span class="stat-label">Today's Follow-ups</span><span class="stat-value">${followUps.todayCount}</span><span class="stat-meta">Due today</span></div>
      <div class="card stat-card"><span class="stat-label">Overdue Follow-ups</span><span class="stat-value">${followUps.overdueCount}</span><span class="stat-meta">Past due, still pending</span></div>
      <div class="card stat-card"><span class="stat-label">Upcoming Follow-ups</span><span class="stat-value">${followUps.upcomingCount}</span></div>
      <div class="card stat-card"><span class="stat-label">Completed Today</span><span class="stat-value">${followUps.completedTodayCount}</span></div>
    `;

    const statusBreakdown = summary.statusBreakdown;
    document.getElementById("my-status-breakdown").innerHTML = statusBreakdown.length
      ? `<div class="flex gap-3" style="flex-wrap:wrap">${statusBreakdown
          .map(
            (s) => `<div class="badge badge-neutral" style="height:auto;padding:var(--space-2) var(--space-3)">
              ${escapeHtml(s.name)}${s.isFinal ? " ·" : ""} <strong class="num">&nbsp;${s.count}</strong>
            </div>`
          )
          .join("")}</div>`
      : `<p class="text-secondary">No leads assigned to you yet.</p>`;

    await renderCallingList(document.getElementById("calling-list"), statuses, user.id);
  } catch (err) {
    content.innerHTML = errorState({ desc: err.message });
  }
}

main();
