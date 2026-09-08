import { requireRole } from "../session.js";
import { mountShell, refreshFollowUpIndicator } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { followUpsApi } from "../api/resources.js";
import { renderTable } from "../components/dataTable.js";
import { confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { openScheduleModal } from "../components/followUpPanel.js";
import { escapeHtml, formatDateTime, paginationHtml, followUpStatusBadge } from "../components/ui.js";

// Same View set as admin-follow-ups.js (kept in sync deliberately — see
// that file's own comment on why "overdue"/"today" aren't independently
// combinable backend filters). No "Assigned to" filter here at all: the
// backend (leadFollowUpService.scopeFor) already forces this whole list to
// the caller's own follow-ups only — an assignedTo filter would be
// meaningless (there is only ever one possible value: yourself).
const VIEWS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due Today" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const state = { page: 1, pageSize: 20, filters: { view: "" }, currentUser: null };

function buildQuery() {
  const q = { page: state.page, pageSize: state.pageSize };
  if (state.filters.view === "overdue") {
    q.overdue = "true";
  } else if (state.filters.view === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    q.status = "pending";
    q.dateFrom = start.toISOString();
    q.dateTo = end.toISOString();
  } else if (state.filters.view) {
    q.status = state.filters.view;
  }
  return q;
}

function columns() {
  return [
    {
      key: "lead",
      label: "Lead",
      render: (fu) => `
        <a class="table-cell-primary" href="./lead-detail.html?id=${fu.leadId}">${escapeHtml(fu.leadName || "(no name)")}</a>
        <div class="table-cell-muted text-xs">${escapeHtml(fu.leadPhone || "")}</div>`,
    },
    { key: "scheduled", label: "Scheduled", render: (fu) => `<span class="text-sm">${formatDateTime(fu.scheduledAt)}</span>` },
    { key: "status", label: "Status", render: (fu) => followUpStatusBadge(fu.status, fu.isOverdue) },
    { key: "notes", label: "Notes", render: (fu) => (fu.notes ? `<span class="text-sm text-secondary">${escapeHtml(fu.notes.length > 60 ? `${fu.notes.slice(0, 60)}…` : fu.notes)}</span>` : "—") },
    {
      key: "actions",
      label: "",
      render: (fu) =>
        fu.status === "pending"
          ? `
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" data-reschedule="${fu.id}">Reschedule</button>
          <button class="btn btn-secondary btn-sm" data-complete="${fu.id}">Complete</button>
          <button class="btn btn-ghost btn-sm" data-cancel-fu="${fu.id}">Cancel</button>
        </div>`
          : "—",
    },
  ];
}

function wireRowActions(items) {
  const findById = (id) => items.find((f) => String(f.id) === String(id));

  document.querySelectorAll("[data-reschedule]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const fu = findById(btn.dataset.reschedule);
      openScheduleModal({
        title: "Reschedule follow-up",
        currentUser: state.currentUser,
        // No assignableUsers — an Employee may only ever reschedule to
        // themselves (server-enforced too, see leadFollowUpService.
        // requireAssignable), so the modal shows a locked "you" field.
        defaults: fu,
        onSubmit: async (body) => {
          await followUpsApi.update(fu.id, body);
          toastSuccess("Follow-up rescheduled.");
          await refreshList();
          refreshFollowUpIndicator();
        },
      });
    })
  );

  document.querySelectorAll("[data-complete]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Mark this follow-up complete?",
        message: "This records it as done and logs it on the lead's activity timeline.",
        confirmLabel: "Complete",
      });
      if (!ok) return;
      try {
        await followUpsApi.complete(btn.dataset.complete);
        toastSuccess("Follow-up completed.");
        await refreshList();
        refreshFollowUpIndicator();
      } catch (err) {
        toastError(err.message);
      }
    })
  );

  document.querySelectorAll("[data-cancel-fu]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "Cancel this follow-up?", message: "This cannot be undone.", confirmLabel: "Cancel follow-up", danger: true });
      if (!ok) return;
      try {
        await followUpsApi.cancel(btn.dataset.cancelFu);
        toastSuccess("Follow-up cancelled.");
        await refreshList();
        refreshFollowUpIndicator();
      } catch (err) {
        toastError(err.message);
      }
    })
  );
}

async function refreshList() {
  const tableEl = document.getElementById("followups-table");
  const pagerEl = document.getElementById("followups-pager");
  renderTable(tableEl, { columns: columns(), rows: null });

  try {
    const { items, pagination } = await followUpsApi.list(buildQuery());
    renderTable(tableEl, {
      columns: columns(),
      rows: items,
      empty: { icon: "⏰", title: "No follow-ups match this view", desc: "Try a different filter, or check back once one is scheduled." },
    });
    wireRowActions(items);
    pagerEl.innerHTML = paginationHtml(pagination);
    pagerEl.querySelector('[data-page="prev"]')?.addEventListener("click", () => {
      state.page -= 1;
      refreshList();
    });
    pagerEl.querySelector('[data-page="next"]')?.addEventListener("click", () => {
      state.page += 1;
      refreshList();
    });
  } catch (err) {
    tableEl.innerHTML = `<div class="table-wrap"><div class="state-block"><div class="state-title">Couldn't load follow-ups</div><div class="state-desc">${escapeHtml(err.message)}</div></div></div>`;
  }
}

function renderFilterBar(container) {
  container.innerHTML = `
    <div class="card-body flex gap-3" style="flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="min-width:160px;margin-bottom:0">
        <label class="label" for="f-view">View</label>
        <select class="select" id="f-view">${VIEWS.map((v) => `<option value="${v.value}">${v.label}</option>`).join("")}</select>
      </div>
    </div>`;

  const viewSelect = container.querySelector("#f-view");
  viewSelect.value = state.filters.view;
  viewSelect.addEventListener("change", (e) => {
    state.filters.view = e.target.value;
    state.page = 1;
    refreshList();
  });
}

async function main() {
  const user = await requireRole("client_employee");
  if (!user) return;
  const content = mountShell({ activeKey: "follow-ups", title: "Follow-ups" });
  if (!content) return;
  await applyTenantBranding();
  state.currentUser = user;

  const requestedView = new URLSearchParams(window.location.search).get("view");
  if (VIEWS.some((v) => v.value === requestedView)) state.filters.view = requestedView;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Follow-ups</h2>
        <p class="page-subtitle">Your scheduled follow-ups — reschedule, complete, or cancel from here.</p>
      </div>
    </div>
    <div class="card mb-4" id="filter-bar"></div>
    <div id="followups-table"></div>
    <div id="followups-pager"></div>
  `;

  renderFilterBar(document.getElementById("filter-bar"));
  await refreshList();
}

main();
