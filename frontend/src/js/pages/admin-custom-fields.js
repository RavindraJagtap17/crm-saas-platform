import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { customFieldsApi } from "../api/resources.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading } from "../components/ui.js";

const TYPE_LABELS = { text: "Text", select: "Select", number: "Number", date: "Date", textarea: "Long text" };

async function refresh(listEl) {
  listEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  try {
    const { customFields } = await customFieldsApi.list();
    if (!customFields.length) {
      listEl.innerHTML = `<div class="card-body">${emptyState({
        icon: "✎",
        title: "No custom fields yet",
        desc: "Add fields your lead forms need beyond name, phone, and email — text, select, number, date, or long text. No file uploads.",
      })}</div>`;
      return;
    }
    listEl.innerHTML = `
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
      </div>`;
    listEl.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => openForm(listEl, customFields.find((f) => String(f.id) === btn.dataset.edit)))
    );
  } catch (err) {
    listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load custom fields", desc: err.message })}</div>`;
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
            <label class="label" for="cf-key">Field key ${isEdit ? "" : ""}</label>
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
            await customFieldsApi.update(field.id, {
              label: modalEl.querySelector("#cf-label").value.trim(),
              isActive: modalEl.querySelector("#cf-active").checked,
              ...(type === "select" ? { options: optionList } : {}),
            });
          } else {
            await customFieldsApi.create({
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

async function main() {
  const user = await requireRole("tenant_admin");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "custom-fields", title: "Custom Fields" });
  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Custom Fields</h2><p class="page-subtitle">Extra questions your lead forms need. No file uploads.</p></div>
      <button class="btn btn-primary" id="new-btn">+ New Field</button>
    </div>
    <div class="card" id="list"></div>
  `;
  document.getElementById("new-btn").addEventListener("click", () => openForm(document.getElementById("list")));
  await refresh(document.getElementById("list"));
}

main();
