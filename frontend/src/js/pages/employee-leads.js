import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { leadsApi, leadStatusesApi, leadSourcesApi, productsApi, customFieldsApi } from "../api/resources.js";
import { renderTable } from "../components/dataTable.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, formatDate, duplicateBadge, paginationHtml, setButtonLoading } from "../components/ui.js";
import { buildLeadFormHtml, readLeadFormValues, clearLeadFormErrors, showLeadFormError } from "../components/leadForm.js";

const state = { page: 1, pageSize: 20, filters: {}, refData: null };

function statusPill(status) {
  if (!status) return `<span class="text-tertiary">— none —</span>`;
  return `<span class="status-pill"><span class="dot" style="background:${status.color || "#9aa1b3"}"></span>${escapeHtml(status.name)}</span>`;
}

function columns() {
  const ref = state.refData;
  const statusById = new Map(ref.statuses.map((s) => [String(s.id), s]));
  const sourceById = new Map(ref.sources.map((s) => [String(s.id), s]));
  const productById = new Map(ref.products.map((p) => [String(p.id), p]));
  return [
    {
      key: "lead",
      label: "Lead",
      render: (r) => `
        <div class="table-cell-primary">${escapeHtml(r.name || "(no name)")} ${duplicateBadge(r.isDuplicate)}</div>
        <div class="table-cell-muted text-xs">${escapeHtml(r.phone || "")}${r.phone && r.email ? " · " : ""}${escapeHtml(r.email || "")}</div>`,
    },
    { key: "status", label: "Status", render: (r) => statusPill(statusById.get(String(r.statusId))) },
    { key: "source", label: "Source", render: (r) => escapeHtml(sourceById.get(String(r.sourceId))?.name || "—") },
    { key: "product", label: "Product", render: (r) => escapeHtml(productById.get(String(r.productId))?.name || "—") },
    { key: "created", label: "Created", render: (r) => `<span class="text-secondary text-sm">${formatDate(r.createdAt)}</span>` },
  ];
}

async function refreshList() {
  const tableEl = document.getElementById("leads-table");
  const pagerEl = document.getElementById("leads-pager");
  renderTable(tableEl, { columns: columns(), rows: null });

  try {
    const { items, pagination } = await leadsApi.list({ page: state.page, pageSize: state.pageSize, ...state.filters });
    renderTable(tableEl, {
      columns: columns(),
      rows: items,
      onRowClick: (row) => (window.location.href = `./lead-detail.html?id=${row.id}`),
      empty: { icon: "☍", title: "No leads match these filters", desc: "Try clearing a filter — this list shows every lead for your client." },
    });
    pagerEl.innerHTML = paginationHtml(pagination);
    pagerEl.querySelector('[data-page="prev"]')?.addEventListener("click", () => { state.page -= 1; refreshList(); });
    pagerEl.querySelector('[data-page="next"]')?.addEventListener("click", () => { state.page += 1; refreshList(); });
  } catch (err) {
    tableEl.innerHTML = `<div class="table-wrap"><div class="state-block"><div class="state-title">Couldn't load leads</div><div class="state-desc">${escapeHtml(err.message)}</div></div></div>`;
  }
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
    </div>`;
  let t;
  container.querySelector("#f-q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.filters.q = e.target.value.trim(); state.page = 1; refreshList(); }, 350);
  });
  container.querySelector("#f-status").addEventListener("change", (e) => {
    state.filters.statusId = e.target.value; state.page = 1; refreshList();
  });
}

function openCreateLeadModal() {
  const ref = state.refData;
  openModal({
    title: "New lead",
    bodyHtml: `<form id="create-lead-form" novalidate>${buildLeadFormHtml({ sources: ref.sources, products: ref.products, customFieldDefs: ref.customFields })}</form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="create-lead-submit">Create lead</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      const form = modalEl.querySelector("#create-lead-form");
      modalEl.querySelector("#create-lead-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        clearLeadFormErrors(form);
        setButtonLoading(btn, true);
        try {
          const { lead } = await leadsApi.create(readLeadFormValues(form));
          toastSuccess(lead.isDuplicate ? "Lead created — flagged as a possible duplicate." : "Lead created.");
          closeFn();
          window.location.href = `./lead-detail.html?id=${lead.id}`;
        } catch (err) {
          showLeadFormError(form, err.message);
        } finally {
          setButtonLoading(btn, false);
        }
      });
    },
  });
}

async function main() {
  const user = await requireRole("client_employee");
  if (!user) return;
  const content = mountShell({ activeKey: "leads", title: "Leads" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Leads</h2><p class="page-subtitle">All leads for your client.</p></div>
      <button class="btn btn-primary" id="new-lead-btn">+ New Lead</button>
    </div>
    <div class="card mb-4" id="filter-bar"></div>
    <div id="leads-table"></div>
    <div id="leads-pager"></div>
  `;

  const [statuses, sources, products, customFields] = await Promise.all([
    leadStatusesApi.list().then((r) => r.statuses),
    leadSourcesApi.list().then((r) => r.sources),
    productsApi.list().then((r) => r.products),
    customFieldsApi.list().then((r) => r.customFields),
  ]);
  state.refData = { statuses, sources, products, customFields };

  renderFilterBar(document.getElementById("filter-bar"), state.refData);
  document.getElementById("new-lead-btn").addEventListener("click", openCreateLeadModal);
  await refreshList();
}

main();
