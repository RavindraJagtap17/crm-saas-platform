import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { leadsApi, leadStatusesApi, leadSourcesApi, productsApi, customFieldsApi, usersApi } from "../api/resources.js";
import { renderTable } from "../components/dataTable.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import {
  escapeHtml,
  formatDate,
  duplicateBadge,
  emptyState,
  paginationHtml,
  setButtonLoading,
  triggerDownload,
} from "../components/ui.js";
import { buildLeadFormHtml, readLeadFormValues, clearLeadFormErrors, showLeadFormError } from "../components/leadForm.js";

// Bulk actions (§ Lead-list bulk actions) — selection is CURRENT PAGE
// ONLY, deliberately: it's rebuilt fresh from each page's own rows (see
// renderFilterBar/refreshList below clearing it on every page/filter
// change), never accumulated across pages. A Set of lead ids, not row
// objects — the table already re-fetches full rows on every render, so
// there's nothing else worth caching here.
const state = { page: 1, pageSize: 20, filters: {}, refData: null, selectedIds: new Set() };

function statusPill(status) {
  if (!status) return `<span class="text-tertiary">— none —</span>`;
  return `<span class="status-pill"><span class="dot" style="background:${status.color || "#9aa1b3"}"></span>${escapeHtml(status.name)}</span>`;
}

async function loadRefData() {
  const [statuses, sources, products, customFields, users] = await Promise.all([
    leadStatusesApi.list().then((r) => r.statuses),
    leadSourcesApi.list().then((r) => r.sources),
    productsApi.list(true).then((r) => r.products),
    customFieldsApi.list().then((r) => r.customFields),
    usersApi.list().then((r) => r.users).catch(() => []),
  ]);
  return { statuses, sources, products, customFields, users };
}

function renderFilterBar(container, ref) {
  container.innerHTML = `
    <div class="card-body flex gap-3" style="flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="min-width:220px;margin-bottom:0;flex:1">
        <label class="label" for="f-q">Search</label>
        <input class="input" id="f-q" placeholder="Name, phone, or email…" />
      </div>
      <div class="field" style="min-width:160px;margin-bottom:0">
        <label class="label" for="f-status">Status</label>
        <select class="select" id="f-status">
          <option value="">All statuses</option>
          ${ref.statuses.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="min-width:160px;margin-bottom:0">
        <label class="label" for="f-source">Source</label>
        <select class="select" id="f-source">
          <option value="">All sources</option>
          ${ref.sources.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="min-width:160px;margin-bottom:0">
        <label class="label" for="f-product">Product</label>
        <select class="select" id="f-product">
          <option value="">All products</option>
          ${ref.products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="min-width:160px;margin-bottom:0">
        <label class="label" for="f-assigned">Assigned to</label>
        <select class="select" id="f-assigned">
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          ${ref.users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("")}
        </select>
      </div>
      <div class="checkbox-row" style="margin-bottom:9px">
        <input type="checkbox" id="f-dup" />
        <label for="f-dup" class="text-sm">Duplicates only</label>
      </div>
    </div>`;

  let debounceTimer;
  container.querySelector("#f-q").addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.filters.q = e.target.value.trim();
      state.page = 1;
      state.selectedIds.clear();
      refreshList();
    }, 350);
  });
  container.querySelector("#f-status").addEventListener("change", (e) => {
    state.filters.statusId = e.target.value;
    state.page = 1;
    state.selectedIds.clear();
    refreshList();
  });
  container.querySelector("#f-source").addEventListener("change", (e) => {
    state.filters.sourceId = e.target.value;
    state.page = 1;
    state.selectedIds.clear();
    refreshList();
  });
  container.querySelector("#f-product").addEventListener("change", (e) => {
    state.filters.productId = e.target.value;
    state.page = 1;
    state.selectedIds.clear();
    refreshList();
  });
  container.querySelector("#f-assigned").addEventListener("change", (e) => {
    if (e.target.value === "unassigned") {
      state.filters.assignedTo = "";
      state.filters.unassignedOnly = true;
    } else {
      state.filters.unassignedOnly = false;
      state.filters.assignedTo = e.target.value;
    }
    state.page = 1;
    state.selectedIds.clear();
    refreshList();
  });
  container.querySelector("#f-dup").addEventListener("change", (e) => {
    state.filters.isDuplicate = e.target.checked ? "true" : undefined;
    state.page = 1;
    state.selectedIds.clear();
    refreshList();
  });
}

async function refreshList() {
  const tableEl = document.getElementById("leads-table");
  const pagerEl = document.getElementById("leads-pager");
  renderTable(tableEl, { columns: leadColumns(), rows: null });

  const query = {
    page: state.page,
    pageSize: state.pageSize,
    q: state.filters.q,
    statusId: state.filters.statusId,
    sourceId: state.filters.sourceId,
    productId: state.filters.productId,
    assignedTo: state.filters.assignedTo,
    // Real server-side filter (leadModel.buildFilterWhere's own
    // "assigned_to IS NULL" clause) — previously a client-side post-filter
    // on an already-paginated page, which under-counted and broke
    // pagination whenever active, and which CSV export (ignoring
    // pagination entirely) could never have honored correctly either way.
    unassignedOnly: state.filters.unassignedOnly ? "true" : undefined,
    isDuplicate: state.filters.isDuplicate,
  };

  try {
    const { items, pagination } = await leadsApi.list(query);
    state.lastPagination = pagination; // used by the "Export All Filtered" confirmation below
    // Rows still selected from before this fetch, but no longer present on
    // the page (deleted, or excluded by a filter change), shouldn't linger
    // in the selection silently.
    const pageIds = new Set(items.map((l) => l.id));
    for (const id of state.selectedIds) if (!pageIds.has(id)) state.selectedIds.delete(id);

    renderTable(tableEl, {
      columns: leadColumns(),
      rows: items,
      empty: {
        icon: "☍",
        title: "No leads match these filters",
        desc: "Try clearing a filter, or create a new lead to get started.",
      },
    });
    wireRowCheckboxes();
    renderBulkBar(items);
    pagerEl.innerHTML = paginationHtml(pagination);
    pagerEl.querySelector('[data-page="prev"]')?.addEventListener("click", () => {
      state.page -= 1;
      state.selectedIds.clear();
      refreshList();
    });
    pagerEl.querySelector('[data-page="next"]')?.addEventListener("click", () => {
      state.page += 1;
      state.selectedIds.clear();
      refreshList();
    });
  } catch (err) {
    tableEl.innerHTML = `<div class="table-wrap"><div class="state-block"><div class="state-icon">⚠</div><div class="state-title">Couldn't load leads</div><div class="state-desc">${escapeHtml(err.message)}</div></div></div>`;
  }
}

function leadColumns() {
  const ref = state.refData;
  const statusById = new Map(ref.statuses.map((s) => [String(s.id), s]));
  const sourceById = new Map(ref.sources.map((s) => [String(s.id), s]));
  const productById = new Map(ref.products.map((p) => [String(p.id), p]));
  const userById = new Map(ref.users.map((u) => [String(u.id), u]));

  return [
    {
      key: "select",
      label: "",
      render: (r) => `<input type="checkbox" class="lead-select-checkbox" data-lead-id="${r.id}" ${state.selectedIds.has(r.id) ? "checked" : ""} aria-label="Select ${escapeHtml(r.name || r.phone || "lead")}" />`,
    },
    {
      key: "lead",
      label: "Lead",
      render: (r) => `
        <a class="table-cell-primary" href="./lead-detail.html?id=${r.id}">${escapeHtml(r.name || "(no name)")}</a> ${duplicateBadge(r.isDuplicate)}
        <div class="table-cell-muted text-xs">${escapeHtml(r.phone || "")}${r.phone && r.email ? " · " : ""}${escapeHtml(r.email || "")}</div>`,
    },
    { key: "status", label: "Status", render: (r) => statusPill(statusById.get(String(r.statusId))) },
    { key: "source", label: "Source", render: (r) => escapeHtml(sourceById.get(String(r.sourceId))?.name || "—") },
    { key: "product", label: "Product", render: (r) => escapeHtml(productById.get(String(r.productId))?.name || "—") },
    {
      key: "assigned",
      label: "Assigned to",
      render: (r) => (r.assignedTo ? escapeHtml(userById.get(String(r.assignedTo))?.name || `#${r.assignedTo}`) : `<span class="text-tertiary">Unassigned</span>`),
    },
    { key: "created", label: "Created", render: (r) => `<span class="text-secondary text-sm">${formatDate(r.createdAt)}</span>` },
  ];
}

function wireRowCheckboxes() {
  document.querySelectorAll(".lead-select-checkbox").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation()); // no onRowClick anymore, but harmless/defensive
    cb.addEventListener("change", (e) => {
      const id = Number(e.target.dataset.leadId);
      if (e.target.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      renderBulkBar(state.lastItems || []);
    });
  });
}

function renderBulkBar(items) {
  state.lastItems = items; // so a later renderBulkBar() call (e.g. after toggling one checkbox) doesn't need the full list re-passed
  const bar = document.getElementById("bulk-bar");
  if (!bar) return;
  const pageIds = items.map((i) => i.id);
  const selectedCount = state.selectedIds.size;
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => state.selectedIds.has(id));

  bar.innerHTML = `
    <div class="card-body flex items-center gap-3" style="flex-wrap:wrap">
      <label class="flex items-center gap-2 text-sm" style="margin-bottom:0">
        <input type="checkbox" id="select-all-page" ${allOnPageSelected ? "checked" : ""} ${pageIds.length === 0 ? "disabled" : ""} />
        Select all on this page
      </label>
      <span class="text-sm text-secondary">${selectedCount} selected</span>
      ${
        selectedCount > 0
          ? `<div class="flex gap-2" style="margin-left:auto">
              <button class="btn btn-secondary btn-sm" id="bulk-assign-btn">Assign</button>
              <button class="btn btn-secondary btn-sm" id="bulk-status-btn">Change Status</button>
              <button class="btn btn-secondary btn-sm" id="bulk-export-btn">Export Selected</button>
              <button class="btn btn-ghost btn-sm" id="bulk-clear-btn">Clear</button>
            </div>`
          : ""
      }
    </div>`;

  bar.querySelector("#select-all-page").addEventListener("change", (e) => {
    if (e.target.checked) pageIds.forEach((id) => state.selectedIds.add(id));
    else pageIds.forEach((id) => state.selectedIds.delete(id));
    // Row checkboxes' checked state must follow — cheapest correct way is
    // just re-rendering the table from the same already-fetched rows,
    // rather than hand-syncing N checkbox elements individually.
    const tableEl = document.getElementById("leads-table");
    renderTable(tableEl, { columns: leadColumns(), rows: items, empty: { icon: "☍", title: "No leads match these filters" } });
    wireRowCheckboxes();
    renderBulkBar(items);
  });
  bar.querySelector("#bulk-assign-btn")?.addEventListener("click", () => openBulkAssignModal());
  bar.querySelector("#bulk-status-btn")?.addEventListener("click", () => openBulkStatusModal());
  bar.querySelector("#bulk-export-btn")?.addEventListener("click", (e) => exportSelected(e.currentTarget));
  bar.querySelector("#bulk-clear-btn")?.addEventListener("click", () => {
    state.selectedIds.clear();
    const tableEl = document.getElementById("leads-table");
    renderTable(tableEl, { columns: leadColumns(), rows: items, empty: { icon: "☍", title: "No leads match these filters" } });
    wireRowCheckboxes();
    renderBulkBar(items);
  });
}

// Bulk Assign — Client Admin only, matching single-lead assignLead's own
// requireRole("client_admin"). Target roster mirrors admin-lead-detail.js's
// own "Reassign lead" modal exactly (active client_admin/client_employee
// users of this client) — same list, same active-only filter, no new
// selection rule invented for this second surface.
function openBulkAssignModal() {
  const ref = state.refData;
  const activeUsers = ref.users.filter((u) => u.status === "active");
  const count = state.selectedIds.size;

  const { close } = openModal({
    title: `Assign ${count} lead${count === 1 ? "" : "s"}`,
    bodyHtml: `
      <form id="bulk-assign-form" novalidate>
        <div class="field">
          <label class="label" for="bulk-assign-select">Assign to</label>
          <select class="select" id="bulk-assign-select">
            ${activeUsers.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} (${u.role.replace("client_", "")})</option>`).join("")}
          </select>
        </div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="bulk-assign-submit">Assign</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#bulk-assign-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const assignedTo = Number(modalEl.querySelector("#bulk-assign-select").value);
        setButtonLoading(btn, true);
        try {
          const { assignedCount } = await leadsApi.bulkAssign([...state.selectedIds], assignedTo);
          toastSuccess(`${assignedCount} lead${assignedCount === 1 ? "" : "s"} assigned.`);
          closeFn();
          state.selectedIds.clear();
          await refreshList();
        } catch (err) {
          toastError(err.message);
        } finally {
          setButtonLoading(btn, false);
        }
      });
    },
  });
  void close;
}

// Bulk Status Change — open to client_admin here (this page is client_admin
// only); reuses leadsApi.bulkChangeStatus, which writes the exact same
// lead_status_history row per lead a single status change already does
// (see leadService.bulkChangeStatus).
function openBulkStatusModal() {
  const ref = state.refData;
  const count = state.selectedIds.size;

  const { close } = openModal({
    title: `Change status for ${count} lead${count === 1 ? "" : "s"}`,
    bodyHtml: `
      <form id="bulk-status-form" novalidate>
        <div class="field">
          <label class="label" for="bulk-status-select">New status</label>
          <select class="select" id="bulk-status-select">
            ${ref.statuses.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="bulk-status-submit">Update</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#bulk-status-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const statusId = Number(modalEl.querySelector("#bulk-status-select").value);
        setButtonLoading(btn, true);
        try {
          const { updatedCount } = await leadsApi.bulkChangeStatus([...state.selectedIds], statusId);
          toastSuccess(`${updatedCount} lead${updatedCount === 1 ? "" : "s"} updated.`);
          closeFn();
          state.selectedIds.clear();
          await refreshList();
        } catch (err) {
          toastError(err.message);
        } finally {
          setButtonLoading(btn, false);
        }
      });
    },
  });
  void close;
}

// Export Selected — reuses the exact same selection state the bulk
// toolbar already tracks; no second selection mechanism. Per Phase 10:
// keeps the selection and does not reload the list afterward (export
// doesn't mutate anything, unlike Assign/Change Status, so there's
// nothing to refresh).
async function exportSelected(btn) {
  setButtonLoading(btn, true);
  try {
    const { blob, filename } = await leadsApi.exportSelected([...state.selectedIds]);
    triggerDownload(blob, filename);
  } catch (err) {
    toastError(err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// Export All Filtered — same query object refreshList() already sends to
// GET /api/leads, minus page/pageSize (the backend ignores pagination for
// this endpoint entirely; see leadService.exportFilteredLeads). Only
// confirms for a count bigger than what's already visible on one page —
// exporting "what you're already looking at" needs no extra prompt.
async function exportFiltered(btn) {
  const total = state.lastPagination?.total ?? 0;
  if (total > state.pageSize) {
    const ok = await confirmDialog({
      title: "Export all matching leads?",
      message: `This will export all ${total} leads matching your current filters, not just this page.`,
      confirmLabel: "Export",
    });
    if (!ok) return;
  }

  const query = {
    q: state.filters.q,
    statusId: state.filters.statusId,
    sourceId: state.filters.sourceId,
    productId: state.filters.productId,
    assignedTo: state.filters.assignedTo,
    unassignedOnly: state.filters.unassignedOnly ? "true" : undefined,
    isDuplicate: state.filters.isDuplicate,
  };

  setButtonLoading(btn, true);
  try {
    const { blob, filename } = await leadsApi.exportFiltered(query);
    triggerDownload(blob, filename);
  } catch (err) {
    toastError(err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// CSV Import (§ Client Admin — CSV Import of Leads). One modal, three
// in-place steps (upload -> preview -> result) — swaps the SAME modal's
// body/footer innerHTML at each transition rather than opening a new
// modal per step, matching the live-re-render pattern the retry-history
// detail view already established elsewhere in this app. `preview` here
// is only ever the small SUMMARY the server returned (counts + a bounded
// row-detail slice + a one-time token) — the actual parsed CSV rows never
// come back to the browser at all; confirm only ever sends the token back.
function importSummaryHtml(preview) {
  const problemRows = preview.rows.filter((r) => r.status !== "ready");
  return `
    <p class="text-sm text-secondary mb-3">${escapeHtml(preview.filename)}</p>
    <div class="grid-stats mb-4" style="grid-template-columns:repeat(4,1fr)">
      <div class="card stat-card"><span class="stat-label">Total Rows</span><span class="stat-value">${preview.totalRows}</span></div>
      <div class="card stat-card"><span class="stat-label">Ready</span><span class="stat-value">${preview.readyCount}</span></div>
      <div class="card stat-card"><span class="stat-label">Duplicates</span><span class="stat-value">${preview.duplicateCount}</span></div>
      <div class="card stat-card"><span class="stat-label">Invalid</span><span class="stat-value">${preview.invalidCount}</span></div>
    </div>
    ${preview.fileWarnings.length ? `<div class="alert alert-warning mb-3"><span>⚠</span><span>${preview.fileWarnings.map((w) => escapeHtml(w)).join("<br/>")}</span></div>` : ""}
    ${preview.duplicateCount > 0 ? `<p class="text-sm text-tertiary mb-2">Duplicate rows are skipped — they will not be imported.</p>` : ""}
    ${
      problemRows.length
        ? `<div class="table-wrap" style="max-height:280px;overflow:auto">
            <table class="data-table">
              <thead><tr><th>Row</th><th>Status</th><th>Details</th></tr></thead>
              <tbody>
                ${problemRows
                  .map(
                    (r) => `<tr>
                      <td>${r.rowNumber}</td>
                      <td><span class="badge ${r.status === "invalid" ? "badge-danger" : "badge-neutral"}">${r.status === "invalid" ? "Invalid" : "Duplicate"}</span></td>
                      <td class="text-sm">${escapeHtml(r.status === "invalid" ? r.errors.join(" ") : r.duplicateReason)}</td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          ${preview.totalRows > preview.rows.length ? `<p class="text-tertiary text-xs mt-2">Showing the first ${preview.rows.length} of ${preview.totalRows} rows.</p>` : ""}`
        : `<p class="text-tertiary text-sm">Every row is ready to import.</p>`
    }
  `;
}

function importResultHtml(result) {
  return `
    <div class="grid-stats mb-4" style="grid-template-columns:repeat(4,1fr)">
      <div class="card stat-card"><span class="stat-label">Imported</span><span class="stat-value">${result.imported}</span></div>
      <div class="card stat-card"><span class="stat-label">Skipped Duplicates</span><span class="stat-value">${result.skippedDuplicates}</span></div>
      <div class="card stat-card"><span class="stat-label">Skipped Invalid</span><span class="stat-value">${result.skippedInvalid}</span></div>
      <div class="card stat-card"><span class="stat-label">Failed</span><span class="stat-value">${result.failed}</span></div>
    </div>
    ${
      result.failures.length
        ? `<div class="alert alert-danger mb-3"><span>⚠</span><span>${result.failures.map((f) => `Row ${f.rowNumber}: ${escapeHtml(f.error)}`).join("<br/>")}</span></div>`
        : ""
    }
    ${
      result.partialFailures.length
        ? `<div class="alert alert-warning mb-3"><span>⚠</span><span>${result.partialFailures.map((f) => `Row ${f.rowNumber} (lead #${f.leadId}): ${escapeHtml(f.error)}`).join("<br/>")}</span></div>`
        : ""
    }
  `;
}

// Template = a header-only CSV using the exact same column vocabulary
// import itself recognizes (leadImportService.STANDARD_COLUMNS) plus this
// Client's own active custom field labels — built entirely client-side
// from state.refData, already loaded for the New Lead form, rather than a
// new backend endpoint just to emit a few header strings. Escaping mirrors
// the backend's own csvEscapeCell (utils/csv.js) since a custom field
// label could in principle contain a comma/quote.
function csvEscapeHeaderCell(value) {
  const str = String(value ?? "");
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadImportTemplate() {
  const activeCustomFieldLabels = (state.refData.customFields || []).filter((f) => f.is_active).map((f) => f.label);
  const headers = ["Name", "Phone", "Email", "Status", "Source", "Product", "Assigned Employee", ...activeCustomFieldLabels];
  const BOM = "﻿";
  const csv = BOM + headers.map(csvEscapeHeaderCell).join(",") + "\r\n";
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), "lead-import-template.csv");
}

function openImportModal() {
  let preview = null;

  const { close } = openModal({
    title: "Import Leads from CSV",
    bodyHtml: `<div id="import-body"></div>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Close</button>`,
    onMount: (modalEl, closeFn) => {
      function setStep(bodyHtml, footerHtml) {
        modalEl.querySelector("#import-body").innerHTML = bodyHtml;
        const footer = modalEl.querySelector(".modal-footer");
        if (footer) footer.innerHTML = footerHtml;
      }

      function showUploadStep() {
        setStep(
          `<p class="text-sm text-secondary mb-3">Recognized columns: Name, Phone, Email, Status, Source, Product, Assigned Employee, and any of your Client's active custom fields (matched by column header — a file exported from this page already uses these exact names). New leads only — an existing lead is never updated by an import.
             <a href="#" id="import-template-link">Download a blank CSV template</a> with those columns already filled in.
           </p>
           <div class="field"><label class="label" for="import-file-input">CSV file</label><input type="file" class="input" id="import-file-input" accept=".csv" /></div>
           <div id="import-error"></div>`,
          `<button class="btn btn-secondary" data-cancel>Close</button><button class="btn btn-primary" id="import-upload-submit">Upload &amp; Preview</button>`
        );
        modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
        modalEl.querySelector("#import-template-link").addEventListener("click", (e) => {
          e.preventDefault();
          downloadImportTemplate();
        });
        modalEl.querySelector("#import-upload-submit").addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          const file = modalEl.querySelector("#import-file-input").files?.[0];
          const errEl = modalEl.querySelector("#import-error");
          errEl.innerHTML = "";
          if (!file) {
            errEl.innerHTML = `<div class="alert alert-danger">Choose a CSV file first.</div>`;
            return;
          }
          setButtonLoading(btn, true);
          try {
            preview = await leadsApi.previewImport(file);
            showPreviewStep();
          } catch (err) {
            errEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
          } finally {
            setButtonLoading(btn, false);
          }
        });
      }

      function showPreviewStep() {
        const canConfirm = preview.readyCount > 0;
        setStep(
          importSummaryHtml(preview),
          `<button class="btn btn-secondary" id="import-choose-different">Choose Different File</button>
           <button class="btn btn-primary" id="import-confirm-submit" ${canConfirm ? "" : "disabled"}>${
            canConfirm ? `Import ${preview.readyCount} Lead${preview.readyCount === 1 ? "" : "s"}` : "Nothing to Import"
          }</button>`
        );
        modalEl.querySelector("#import-choose-different").addEventListener("click", showUploadStep);
        if (canConfirm) {
          modalEl.querySelector("#import-confirm-submit").addEventListener("click", async (e) => {
            const btn = e.currentTarget;
            setButtonLoading(btn, true);
            try {
              const result = await leadsApi.confirmImport(preview.token);
              showResultStep(result);
            } catch (err) {
              toastError(err.message);
            } finally {
              setButtonLoading(btn, false);
            }
          });
        }
      }

      function showResultStep(result) {
        setStep(importResultHtml(result), `<button class="btn btn-primary" id="import-done">Done</button>`);
        toastSuccess(`${result.imported} lead${result.imported === 1 ? "" : "s"} imported.`);
        modalEl.querySelector("#import-done").addEventListener("click", async () => {
          closeFn();
          await refreshList();
        });
      }

      showUploadStep();
    },
  });
  void close;
}

function openCreateLeadModal() {
  const ref = state.refData;
  const { close } = openModal({
    title: "New lead",
    bodyHtml: `<form id="create-lead-form" novalidate>${buildLeadFormHtml({ sources: ref.sources, products: ref.products, customFieldDefs: ref.customFields })}</form>`,
    footerHtml: `
      <button class="btn btn-secondary" data-cancel>Cancel</button>
      <button class="btn btn-primary" id="create-lead-submit">Create lead</button>
    `,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      const form = modalEl.querySelector("#create-lead-form");
      const submitBtn = modalEl.querySelector("#create-lead-submit");
      submitBtn.addEventListener("click", async () => {
        clearLeadFormErrors(form);
        setButtonLoading(submitBtn, true);
        try {
          const body = readLeadFormValues(form);
          const { lead } = await leadsApi.create(body);
          toastSuccess(lead.isDuplicate ? "Lead created — flagged as a possible duplicate." : "Lead created.");
          closeFn();
          window.location.href = `./lead-detail.html?id=${lead.id}`;
        } catch (err) {
          showLeadFormError(form, err.message);
        } finally {
          setButtonLoading(submitBtn, false);
        }
      });
    },
  });
}

async function main() {
  const user = await requireRole("client_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "leads", title: "Leads" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Leads</h2>
        <p class="page-subtitle">All leads for your client.</p>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-secondary" id="import-csv-btn">Import CSV</button>
        <button class="btn btn-secondary" id="export-filtered-btn">Export All Filtered</button>
        <button class="btn btn-primary" id="new-lead-btn">+ New Lead</button>
      </div>
    </div>
    <div class="card mb-4" id="filter-bar"></div>
    <div class="card mb-3" id="bulk-bar"></div>
    <div id="leads-table"></div>
    <div id="leads-pager"></div>
  `;

  try {
    state.refData = await loadRefData();
  } catch (err) {
    content.querySelector("#leads-table").innerHTML = emptyState({ title: "Couldn't load setup data", desc: err.message });
    return;
  }

  renderFilterBar(document.getElementById("filter-bar"), state.refData);
  document.getElementById("new-lead-btn").addEventListener("click", openCreateLeadModal);
  document.getElementById("import-csv-btn").addEventListener("click", openImportModal);
  document.getElementById("export-filtered-btn").addEventListener("click", (e) => exportFiltered(e.currentTarget));
  await refreshList();
}

main();
