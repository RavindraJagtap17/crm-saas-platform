import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { clientsApi } from "../api/resources.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, qs } from "../components/ui.js";

/**
 * Post-Phase-D ownership fix: Custom Field DEFINITIONS are client-scoped
 * DATA (custom_field_definitions.client_id = the selected client — no
 * duplication, no separate agency-level table) but are now MANAGED by
 * Agency Admin, not Client Admin. This page is a client-selector wrapper
 * around the exact same list/create/update flow the old Client Admin
 * page used — only the API surface changed (clientsApi.customFields.*,
 * validated server-side against the caller's own agency) and who's
 * allowed to reach it.
 */

const TYPE_LABELS = { text: "Text", select: "Select", number: "Number", date: "Date", textarea: "Long text" };

let clients = [];
let selectedClientId = null;

function clientSelectorHtml() {
  return `
    <div class="card card-pad mb-4">
      <div class="field" style="margin-bottom:0;max-width:360px">
        <label class="label" for="cf-client-select">Client</label>
        <select class="select" id="cf-client-select">
          <option value="">Select a client…</option>
          ${clients.map((c) => `<option value="${c.id}" ${String(c.id) === String(selectedClientId) ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </div>
    </div>`;
}

async function refresh(listEl) {
  if (!selectedClientId) {
    listEl.innerHTML = emptyState({ icon: "✎", title: "Select a client", desc: "Choose one of your clients above to manage its custom fields." });
    return;
  }
  listEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  try {
    const { customFields } = await clientsApi.customFields.list(selectedClientId);
    if (!customFields.length) {
      listEl.innerHTML = `<div class="card">${emptyState({
        icon: "✎",
        title: "No custom fields yet",
        desc: "Add fields this client's lead forms need beyond name, phone, and email — text, select, number, date, or long text. No file uploads.",
      })}</div>`;
      return;
    }
    listEl.innerHTML = `
      <div class="card">
        <div class="table-wrap" style="border:none;border-radius:0">
          <table class="data-table">
            <thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${customFields
                .map(
                  (f) => `
                <tr>
                  <td data-label="Label" class="table-cell-primary">${escapeHtml(f.label)}</td>
                  <td data-label="Key" class="table-cell-muted num text-xs">${escapeHtml(f.field_key)}</td>
                  <td data-label="Type"><span class="badge badge-brand">${TYPE_LABELS[f.field_type] || f.field_type}</span></td>
                  <td data-label="Status">${f.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
                  <td data-label=""><button class="btn btn-secondary btn-sm" data-edit="${f.id}">Edit</button></td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>`;
    listEl.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => openForm(listEl, customFields.find((f) => String(f.id) === btn.dataset.edit)))
    );
  } catch (err) {
    listEl.innerHTML = `<div class="card">${emptyState({ icon: "⚠", title: "Couldn't load custom fields", desc: err.message })}</div>`;
  }
}

function toggleOptionsVisibility(modalEl) {
  const isSelect = modalEl.querySelector("#cf-type").value === "select";
  modalEl.querySelector("#cf-options-field").style.display = isSelect ? "" : "none";
}

function openForm(listEl, field) {
  const isEdit = !!field;
  const options = field?.options ? (Array.isArray(field.options) ? field.options : JSON.parse(field.options)) : [];
  const { close } = openModal({
    title: isEdit ? "Edit custom field" : "New custom field",
    bodyHtml: `
      <form id="cf-form" novalidate>
        <div class="field">
          <label class="label" for="cf-label">Label</label>
          <input class="input" id="cf-label" value="${escapeHtml(field?.label || "")}" placeholder="e.g. Budget" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="cf-key">Field key</label>
            <input class="input" id="cf-key" value="${escapeHtml(field?.field_key || "")}" placeholder="budget" ${isEdit ? "disabled" : ""} />
            <span class="hint">lowercase, no spaces — used internally, can't change later</span>
          </div>
          <div class="field">
            <label class="label" for="cf-type">Type</label>
            <select class="select" id="cf-type" ${isEdit ? "disabled" : ""}>
              ${Object.entries(TYPE_LABELS)
                .map(([val, label]) => `<option value="${val}" ${field?.field_type === val ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
          </div>
        </div>
        <div class="field" id="cf-options-field">
          <label class="label" for="cf-options">Options <span class="optional">(comma-separated)</span></label>
          <input class="input" id="cf-options" value="${escapeHtml(options.join(", "))}" placeholder="Low, Medium, High" />
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="cf-active" ${field ? (field.is_active ? "checked" : "") : "checked"} ${isEdit ? "" : "style='display:none'"} />
          <label for="cf-active" class="text-sm" ${isEdit ? "" : 'style="display:none"'}>Active</label>
        </div>
        <div class="field-error" id="cf-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="cf-submit">${isEdit ? "Save changes" : "Create field"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#cf-type").addEventListener("change", () => toggleOptionsVisibility(modalEl));
      toggleOptionsVisibility(modalEl);

      modalEl.querySelector("#cf-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#cf-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const type = modalEl.querySelector("#cf-type").value;
        const optionList = modalEl
          .querySelector("#cf-options")
          .value.split(",")
          .map((o) => o.trim())
          .filter(Boolean);

        try {
          if (isEdit) {
            await clientsApi.customFields.update(selectedClientId, field.id, {
              label: modalEl.querySelector("#cf-label").value.trim(),
              isActive: modalEl.querySelector("#cf-active").checked,
              ...(type === "select" ? { options: optionList } : {}),
            });
          } else {
            await clientsApi.customFields.create(selectedClientId, {
              fieldKey: modalEl.querySelector("#cf-key").value.trim(),
              label: modalEl.querySelector("#cf-label").value.trim(),
              fieldType: type,
              ...(type === "select" ? { options: optionList } : {}),
            });
          }
          closeFn();
          toastSuccess(isEdit ? "Custom field updated." : "Custom field created.");
          refresh(listEl);
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = err.message;
        } finally {
          setButtonLoading(btn, false);
        }
      });
    },
  });
  void close;
}

function selectClient(content, clientId) {
  selectedClientId = clientId;
  const url = new URL(window.location.href);
  if (clientId) url.searchParams.set("clientId", clientId);
  else url.searchParams.delete("clientId");
  history.replaceState(null, "", url.pathname + qs(Object.fromEntries(url.searchParams)));
  document.getElementById("new-field-btn").disabled = !clientId;
  refresh(document.getElementById("list"));
}

async function main() {
  const user = await requireRole("agency_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "custom-fields", title: "Custom Fields" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Custom Fields</h2>
        <p class="page-subtitle">Extra questions a client's lead forms need. Select a client to manage its fields.</p>
      </div>
      <button class="btn btn-primary" id="new-field-btn" disabled>+ New Field</button>
    </div>
    <div id="client-picker"></div>
    <div id="list"></div>
  `;

  try {
    ({ clients } = await clientsApi.list());
  } catch (err) {
    document.getElementById("list").innerHTML = emptyState({ title: "Couldn't load your clients", desc: err.message });
    return;
  }

  if (!clients.length) {
    document.getElementById("client-picker").innerHTML = "";
    document.getElementById("list").innerHTML = emptyState({
      icon: "◎",
      title: "Add a client first",
      desc: "Custom fields belong to one of your clients.",
      actionHtml: `<a class="btn btn-secondary" href="./clients.html">Go to Clients</a>`,
    });
    return;
  }

  const preselect = new URLSearchParams(window.location.search).get("clientId");
  selectedClientId = preselect && clients.some((c) => String(c.id) === preselect) ? preselect : null;

  document.getElementById("client-picker").innerHTML = clientSelectorHtml();
  document.getElementById("client-picker").querySelector("#cf-client-select").addEventListener("change", (e) => {
    selectClient(content, e.target.value || null);
  });
  document.getElementById("new-field-btn").disabled = !selectedClientId;
  document.getElementById("new-field-btn").addEventListener("click", () => openForm(document.getElementById("list")));

  await refresh(document.getElementById("list"));
}

main();
