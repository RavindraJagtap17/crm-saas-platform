import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { renderTable } from "../components/dataTable.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toast, toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, formatDateTime, paginationHtml, errorState, setButtonLoading } from "../components/ui.js";

// Same fixed set every provider-facing page in this app already uses —
// not auto-discovered (there is no "list every provider that has ever
// been seen" endpoint, and inventing one isn't warranted for a 4-item
// filter dropdown).
const PROVIDERS = [
  { value: "", label: "All providers" },
  { value: "meta", label: "Meta" },
  { value: "google", label: "Google Ads" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "indiamart", label: "IndiaMART" },
];

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "received", label: "Received" },
  { value: "processing", label: "Processing" },
  { value: "processed", label: "Processed" },
  { value: "duplicate", label: "Duplicate" },
  { value: "failed", label: "Failed" },
];

const STATUS_BADGE = { received: "badge-neutral", processing: "badge-neutral", processed: "badge-success", duplicate: "badge-neutral", failed: "badge-danger" };
const STATUS_LABEL = { received: "Received", processing: "Processing", processed: "Processed", duplicate: "Duplicate", failed: "Failed" };
const RETRY_RESULT_BADGE = { SUCCESS: "badge-success", FAILED: "badge-danger", REJECTED: "badge-neutral", IN_PROGRESS: "badge-warning" };

const state = { page: 1, pageSize: 25, filters: {}, agencies: [] };

function metricsHtml(summary) {
  const cards = [
    { label: "Total Events", value: summary.total },
    { label: "Failed", value: summary.failed },
    { label: "Processing", value: summary.processing },
    { label: "Received", value: summary.received },
    { label: "Duplicate", value: summary.duplicate },
    { label: "Processed", value: summary.processed },
    { label: "Recovered", value: summary.recovered, meta: "subset of Received" },
    { label: "Retry Pending", value: summary.retryPending, meta: "subset of Failed" },
  ];
  return cards
    .map(
      (c) => `
    <div class="card stat-card">
      <span class="stat-label">${c.label}</span>
      <span class="stat-value">${c.value}</span>
      ${c.meta ? `<span class="stat-meta">${c.meta}</span>` : ""}
    </div>`
    )
    .join("");
}

function eventColumns() {
  return [
    {
      key: "agencyClient",
      label: "Agency / Client",
      render: (ev) => `
        <div class="table-cell-primary">${ev.tenantName ? escapeHtml(ev.tenantName) : `<span class="text-tertiary">Unknown agency</span>`}</div>
        <div class="table-cell-muted text-xs">${ev.clientName ? escapeHtml(ev.clientName) : ev.clientId ? `#${ev.clientId}` : "—"}</div>`,
    },
    {
      key: "provider",
      label: "Provider",
      render: (ev) => `<span class="badge badge-neutral">${escapeHtml(ev.providerLabel)}</span>`,
    },
    {
      key: "event",
      label: "Event",
      render: (ev) => `
        <div class="table-cell-primary">#${ev.id}</div>
        <div class="table-cell-muted text-xs" title="${escapeHtml(ev.externalLeadId)}">${escapeHtml(
          ev.externalLeadId.length > 36 ? `${ev.externalLeadId.slice(0, 36)}…` : ev.externalLeadId
        )}</div>`,
    },
    {
      key: "status",
      label: "Status",
      render: (ev) => `
        <span class="badge ${STATUS_BADGE[ev.status] || "badge-neutral"}">${STATUS_LABEL[ev.status] || ev.status}</span>
        ${ev.recovered ? ` <span class="badge badge-warning" title="Reset back to 'received' after getting stuck in 'processing'">Recovered</span>` : ""}
        <div class="table-cell-muted text-xs">${escapeHtml(ev.summary)}</div>
        ${ev.status === "failed" && ev.nextAttemptAt ? `<div class="text-tertiary text-xs">Next retry: ${formatDateTime(ev.nextAttemptAt)}</div>` : ""}`,
    },
    { key: "attempts", label: "Attempts", render: (ev) => ev.attempts },
    {
      key: "crmLead",
      label: "CRM Lead",
      render: (ev) => (ev.crmLeadId ? `<a href="/public/admin/lead-detail.html?id=${ev.crmLeadId}" target="_blank" rel="noopener">#${ev.crmLeadId}</a>` : "—"),
    },
    { key: "created", label: "Created", render: (ev) => `<span class="text-secondary text-sm">${formatDateTime(ev.receivedAt)}</span>` },
    { key: "updated", label: "Updated", render: (ev) => `<span class="text-secondary text-sm">${formatDateTime(ev.updatedAt)}</span>` },
  ];
}

function attributionHtml(attribution) {
  if (!attribution || typeof attribution !== "object" || !Object.keys(attribution).length) return `<p class="text-tertiary text-sm">None recorded.</p>`;
  return `
    <table class="data-table">
      <tbody>
        ${Object.entries(attribution)
          .map(([k, v]) => `<tr><td class="table-cell-primary" style="width:40%">${escapeHtml(k)}</td><td>${escapeHtml(v === null || v === undefined ? "—" : String(v))}</td></tr>`)
          .join("")}
      </tbody>
    </table>`;
}

// Display-only convenience — matches integrationMonitoringService.
// classifyRetryEligibility's own rule set exactly, but this is NOT the
// security boundary: it only decides whether to SHOW the button. The
// server re-derives eligibility from the persisted row independently on
// every retry attempt, so a stale or tampered client-side read here can
// only ever produce a REJECTED/IN_PROGRESS response, never an unsafe retry.
function isRetryEligible(ev) {
  if (ev.provider === "meta") return false;
  if (ev.status === "processed" || ev.status === "duplicate") return false;
  if (ev.status === "processing") return false;
  if (ev.status === "failed" && !ev.nextAttemptAt) return false;
  return ev.status === "failed" || ev.status === "received";
}

// "Retry History" — manual Super Admin retry attempts only (every row this
// reads was written by handleRetryClick's own POST .../retry, via
// integrationMonitoringService.retryEvent's auditRetryAttempt — scheduler/
// backoff retries never write to audit_logs at all, so nothing here needs
// its own manual-vs-automatic flag to avoid mislabeling one as the other).
function retryHistoryHtml(items) {
  if (!items.length) return `<p class="text-tertiary text-sm">No manual retry attempts for this event.</p>`;
  return items
    .map(
      (h) => `
    <div class="py-2" style="border-bottom:1px solid var(--border)">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <span class="text-sm text-secondary">${formatDateTime(h.createdAt)}</span>
        <span class="badge ${RETRY_RESULT_BADGE[h.result] || "badge-neutral"}">${h.result}</span>
        ${h.attempts != null ? `<span class="text-tertiary text-xs">Attempt ${h.attempts}</span>` : ""}
      </div>
      <div class="text-sm">${escapeHtml(h.initiatedBy)}${h.actorRole ? ` <span class="text-tertiary text-xs">(${escapeHtml(h.actorRole.replace(/_/g, " "))})</span>` : ""}</div>
      ${
        h.previousStatus || h.newStatus
          ? `<div class="text-tertiary text-xs">${h.previousStatus ? STATUS_LABEL[h.previousStatus] || h.previousStatus : "—"} → ${h.newStatus ? STATUS_LABEL[h.newStatus] || h.newStatus : "—"}</div>`
          : ""
      }
      ${h.message ? `<div class="text-sm">${escapeHtml(h.message)}</div>` : ""}
    </div>`
    )
    .join("");
}

function detailBodyHtml(ev, history) {
  const eligible = isRetryEligible(ev);
  return `
    <div class="field-row">
      <div><span class="label">Agency</span><p>${ev.tenantName ? escapeHtml(ev.tenantName) : "Unknown"}</p></div>
      <div><span class="label">Client</span><p>${ev.clientName ? escapeHtml(ev.clientName) : ev.clientId ? `#${ev.clientId}` : "—"}</p></div>
      <div><span class="label">Provider</span><p>${escapeHtml(ev.providerLabel)}</p></div>
      <div><span class="label">Status</span><p><span class="badge ${STATUS_BADGE[ev.status] || "badge-neutral"}">${STATUS_LABEL[ev.status] || ev.status}</span>${ev.recovered ? ` <span class="badge badge-warning">Recovered</span>` : ""}</p></div>
    </div>
    <div class="divider"></div>
    <div class="field-row">
      <div><span class="label">External ID</span><p class="text-sm"><code>${escapeHtml(ev.externalLeadId)}</code></p></div>
      <div><span class="label">CRM Lead</span><p>${ev.crmLeadId ? `<a href="/public/admin/lead-detail.html?id=${ev.crmLeadId}" target="_blank" rel="noopener">#${ev.crmLeadId}</a>` : "—"}</p></div>
      <div><span class="label">Attempts</span><p>${ev.attempts}</p></div>
      <div><span class="label">Next retry</span><p>${ev.nextAttemptAt ? formatDateTime(ev.nextAttemptAt) : "—"}</p></div>
    </div>
    <div class="field-row">
      <div><span class="label">Received</span><p class="text-sm">${formatDateTime(ev.receivedAt)}</p></div>
      <div><span class="label">Processed</span><p class="text-sm">${ev.processedAt ? formatDateTime(ev.processedAt) : "—"}</p></div>
      <div><span class="label">Updated</span><p class="text-sm">${formatDateTime(ev.updatedAt)}</p></div>
      <div><span class="label">Required enrichment</span><p class="text-sm">${ev.needsEnrichment ? "Yes (fetched from provider after receipt)" : "No (complete payload on delivery)"}</p></div>
    </div>
    <div class="divider"></div>
    <p class="text-sm">${escapeHtml(ev.summary)}</p>
    ${ev.lastError ? `<div class="alert alert-warning"><span>⚠</span><span>${escapeHtml(ev.lastError)}</span></div>` : ""}
    ${eligible ? `<div class="mt-3"><button class="btn btn-primary btn-sm" id="retry-now-btn">Retry Now</button></div>` : ""}
    <div class="divider"></div>
    <h3 class="card-title" style="font-size:1rem">Retry History</h3>
    ${retryHistoryHtml(history)}
    <div class="divider"></div>
    <h3 class="card-title" style="font-size:1rem">Attribution</h3>
    ${attributionHtml(ev.attribution)}
    <div class="divider"></div>
    <h3 class="card-title" style="font-size:1rem">Raw payload <span class="text-tertiary text-sm">(tokens/secrets/signatures redacted)</span></h3>
    <pre class="text-xs" style="white-space:pre-wrap;word-break:break-all;background:var(--surface-2);padding:var(--space-3);border-radius:var(--radius-md);max-height:280px;overflow:auto">${escapeHtml(JSON.stringify(ev.rawPayload, null, 2))}</pre>
  `;
}

async function loadAndRenderDetail(id) {
  const body = document.getElementById("event-detail-body");
  if (!body) return; // modal already closed
  try {
    const [ev, history] = await Promise.all([superAdminApi.getIntegrationEvent(id), superAdminApi.getRetryHistory(id)]);
    body.innerHTML = detailBodyHtml(ev, history.items);
    const retryBtn = document.getElementById("retry-now-btn");
    if (retryBtn) retryBtn.addEventListener("click", () => handleRetryClick(ev, retryBtn));
  } catch (err) {
    body.innerHTML = errorState({ desc: err.message });
  }
}

async function handleRetryClick(ev, btn) {
  const ok = await confirmDialog({
    title: "Retry this integration event now?",
    message: `
      Provider: ${escapeHtml(ev.providerLabel)}<br/>
      Client: ${ev.clientName ? escapeHtml(ev.clientName) : ev.clientId ? `#${ev.clientId}` : "Unknown"}<br/>
      Event: #${ev.id}<br/>
      Current status: ${STATUS_LABEL[ev.status] || ev.status}<br/>
      Attempts so far: ${ev.attempts}
    `,
    confirmLabel: "Retry Now",
  });
  if (!ok) return;

  setButtonLoading(btn, true);
  try {
    const { result, message } = await superAdminApi.retryIntegrationEvent(ev.id);
    if (result === "SUCCESS") toastSuccess(message);
    else if (result === "FAILED") toastError(message);
    else toast(message, { type: "info" }); // IN_PROGRESS / REJECTED
  } catch (err) {
    toastError(err.message);
  } finally {
    await loadAndRenderDetail(ev.id);
    await refreshList();
  }
}

async function openEventDetail(eventRow) {
  const { close } = openModal({
    title: `Event #${eventRow.id}`,
    bodyHtml: `<div id="event-detail-body"><div class="skeleton skeleton-row"></div></div>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Close</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
    },
  });

  await loadAndRenderDetail(eventRow.id);
  void close;
}

function renderFilterBar(container) {
  container.innerHTML = `
    <div class="card-body flex gap-3" style="flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="min-width:220px;margin-bottom:0;flex:1">
        <label class="label" for="f-search">Search</label>
        <input class="input" id="f-search" placeholder="Event ID or external lead ID…" />
      </div>
      <div class="field" style="min-width:160px;margin-bottom:0">
        <label class="label" for="f-provider">Provider</label>
        <select class="select" id="f-provider">${PROVIDERS.map((p) => `<option value="${p.value}">${p.label}</option>`).join("")}</select>
      </div>
      <div class="field" style="min-width:160px;margin-bottom:0">
        <label class="label" for="f-status">Status</label>
        <select class="select" id="f-status">${STATUSES.map((s) => `<option value="${s.value}">${s.label}</option>`).join("")}</select>
      </div>
      <div class="field" style="min-width:180px;margin-bottom:0">
        <label class="label" for="f-agency">Agency</label>
        <select class="select" id="f-agency">
          <option value="">All agencies</option>
          ${state.agencies.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="min-width:120px;margin-bottom:0">
        <label class="label" for="f-client">Client ID</label>
        <input class="input" id="f-client" placeholder="e.g. 5" inputmode="numeric" />
      </div>
      <div class="field" style="min-width:150px;margin-bottom:0">
        <label class="label" for="f-from">From</label>
        <input class="input" type="date" id="f-from" />
      </div>
      <div class="field" style="min-width:150px;margin-bottom:0">
        <label class="label" for="f-to">To</label>
        <input class="input" type="date" id="f-to" />
      </div>
    </div>`;

  let debounceTimer;
  container.querySelector("#f-search").addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.filters.search = e.target.value.trim();
      state.page = 1;
      refreshList();
    }, 350);
  });
  container.querySelector("#f-provider").addEventListener("change", (e) => {
    state.filters.provider = e.target.value;
    state.page = 1;
    refreshList();
  });
  container.querySelector("#f-status").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    state.page = 1;
    refreshList();
  });
  container.querySelector("#f-agency").addEventListener("change", (e) => {
    state.filters.agencyId = e.target.value;
    state.page = 1;
    refreshList();
  });
  container.querySelector("#f-client").addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.filters.clientId = e.target.value.trim();
      state.page = 1;
      refreshList();
    }, 350);
  });
  container.querySelector("#f-from").addEventListener("change", (e) => {
    state.filters.from = e.target.value;
    state.page = 1;
    refreshList();
  });
  container.querySelector("#f-to").addEventListener("change", (e) => {
    state.filters.to = e.target.value;
    state.page = 1;
    refreshList();
  });
}

async function refreshList() {
  const metricsEl = document.getElementById("metrics");
  const tableEl = document.getElementById("events-table");
  const pagerEl = document.getElementById("events-pager");
  renderTable(tableEl, { columns: eventColumns(), rows: null });

  const query = {
    page: state.page,
    pageSize: state.pageSize,
    ...state.filters,
  };

  try {
    const { items, pagination, summary } = await superAdminApi.listIntegrationEvents(query);
    metricsEl.innerHTML = metricsHtml(summary);

    renderTable(tableEl, {
      columns: eventColumns(),
      rows: items,
      onRowClick: (row) => openEventDetail(row),
      empty: { icon: "⌗", title: "No events match these filters", desc: "Try clearing a filter or widening the date range." },
    });
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
    tableEl.innerHTML = `<div class="table-wrap">${errorState({ desc: err.message })}</div>`;
  }
}

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "integration-monitoring", title: "Integration Monitoring" });
  if (!content) return;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Integration Monitoring</h2>
        <p class="page-subtitle">Every lead-ingestion event across every Agency and Client — diagnose failed, stuck, or retrying deliveries without needing database access.</p>
      </div>
    </div>
    <div class="grid-stats mb-6" id="metrics">${Array(8).fill(0).map(() => `<div class="card stat-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-row" style="width:40%;height:28px"></div></div>`).join("")}</div>
    <div class="card mb-4" id="filter-bar"></div>
    <div class="card">
      <div id="events-table"></div>
      <div class="card-body" id="events-pager"></div>
    </div>
  `;

  try {
    const { tenants } = await superAdminApi.listTenants({});
    state.agencies = tenants;
  } catch {
    state.agencies = [];
  }

  renderFilterBar(document.getElementById("filter-bar"));
  await refreshList();
}

main();
