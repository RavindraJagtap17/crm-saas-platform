import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { leadStatusesApi } from "../api/resources.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading } from "../components/ui.js";

const DEFAULT_COLOR = "#4f46e5";

async function refresh(listEl) {
  listEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row" style="width:70%"></div></div>`;
  try {
    const { statuses } = await leadStatusesApi.list();
    if (!statuses.length) {
      listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "◔", title: "No statuses yet", desc: "Create your first pipeline stage, like “New” or “Hot”." })}</div>`;
      return;
    }
    listEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Status</th><th>Sort order</th><th>Final</th><th></th></tr></thead>
          <tbody>
            ${statuses
              .map(
                (s) => `
              <tr>
                <td data-label="Status"><span class="status-pill"><span class="dot" style="background:${s.color || DEFAULT_COLOR}"></span>${escapeHtml(s.name)}</span></td>
                <td data-label="Sort order" class="num">${s.sort_order}</td>
                <td data-label="Final">${s.is_final ? '<span class="badge badge-success">Final</span>' : '<span class="text-tertiary">—</span>'}</td>
                <td data-label=""><button class="btn btn-secondary btn-sm" data-edit="${s.id}">Edit</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
    listEl.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => openForm(listEl, statuses.find((s) => String(s.id) === btn.dataset.edit)))
    );
  } catch (err) {
    listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load statuses", desc: err.message })}</div>`;
  }
}

function openForm(listEl, status) {
  const isEdit = !!status;
  const { close } = openModal({
    title: isEdit ? "Edit status" : "New status",
    bodyHtml: `
      <form id="status-form" novalidate>
        <div class="field">
          <label class="label" for="s-name">Name</label>
          <input class="input" id="s-name" value="${escapeHtml(status?.name || "")}" placeholder="e.g. Hot" />
          <div class="field-error" hidden></div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="s-color">Color</label>
            <input class="input" type="color" id="s-color" value="${status?.color || DEFAULT_COLOR}" style="height:40px;padding:4px" />
          </div>
          <div class="field">
            <label class="label" for="s-sort">Sort order</label>
            <input class="input" type="number" id="s-sort" value="${status?.sort_order ?? 0}" />
          </div>
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="s-final" ${status?.is_final ? "checked" : ""} />
          <label for="s-final" class="text-sm">This is a final pipeline stage (e.g. Converted, Lost)</label>
        </div>
        <div class="field-error" id="s-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="s-submit">${isEdit ? "Save changes" : "Create status"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#s-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#s-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const body = {
          name: modalEl.querySelector("#s-name").value.trim(),
          color: modalEl.querySelector("#s-color").value,
          sortOrder: Number(modalEl.querySelector("#s-sort").value) || 0,
          isFinal: modalEl.querySelector("#s-final").checked,
        };
        try {
          if (isEdit) await leadStatusesApi.update(status.id, body);
          else await leadStatusesApi.create(body);
          closeFn();
          toastSuccess(isEdit ? "Status updated." : "Status created.");
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
  const user = await requireRole("client_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "statuses", title: "Lead Statuses" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Lead Statuses</h2>
        <p class="page-subtitle">Your pipeline stages — reorder by editing the sort order.</p>
      </div>
      <button class="btn btn-primary" id="new-btn">+ New Status</button>
    </div>
    <div class="card" id="list"></div>
  `;
  document.getElementById("new-btn").addEventListener("click", () => openForm(document.getElementById("list")));
  await refresh(document.getElementById("list"));
}

main();
