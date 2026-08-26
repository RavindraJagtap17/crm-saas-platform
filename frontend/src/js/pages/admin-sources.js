import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { leadSourcesApi } from "../api/resources.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading } from "../components/ui.js";

async function refresh(listEl) {
  listEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  try {
    const { sources } = await leadSourcesApi.list();
    if (!sources.length) {
      listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⌘", title: "No sources yet", desc: "A “Manual” source is created automatically the first time you add a lead by hand." })}</div>`;
      return;
    }
    listEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Type</th><th></th></tr></thead>
          <tbody>
            ${sources
              .map(
                (s) => `
              <tr>
                <td data-label="Name" class="table-cell-primary">${escapeHtml(s.name)}</td>
                <td data-label="Type">${s.type ? `<span class="badge badge-neutral">${escapeHtml(s.type)}</span>` : "—"}</td>
                <td data-label=""><button class="btn btn-secondary btn-sm" data-edit="${s.id}">Edit</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
    listEl.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => openForm(listEl, sources.find((s) => String(s.id) === btn.dataset.edit)))
    );
  } catch (err) {
    listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load sources", desc: err.message })}</div>`;
  }
}

function openForm(listEl, source) {
  const isEdit = !!source;
  openModal({
    title: isEdit ? "Edit source" : "New source",
    bodyHtml: `
      <form id="src-form" novalidate>
        <div class="field">
          <label class="label" for="src-name">Name</label>
          <input class="input" id="src-name" value="${escapeHtml(source?.name || "")}" placeholder="e.g. Referral" />
        </div>
        <div class="field">
          <label class="label" for="src-type">Type <span class="optional">(optional)</span></label>
          <input class="input" id="src-type" value="${escapeHtml(source?.type || "")}" placeholder="e.g. referral" />
          <span class="hint">A short internal tag — not shown to leads.</span>
        </div>
        <div class="field-error" id="src-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="src-submit">${isEdit ? "Save changes" : "Create source"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#src-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#src-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const body = { name: modalEl.querySelector("#src-name").value.trim(), type: modalEl.querySelector("#src-type").value.trim() || undefined };
        try {
          if (isEdit) await leadSourcesApi.update(source.id, body);
          else await leadSourcesApi.create(body);
          closeFn();
          toastSuccess(isEdit ? "Source updated." : "Source created.");
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
}

async function main() {
  const user = await requireRole("tenant_admin");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "sources", title: "Lead Sources" });
  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Lead Sources</h2><p class="page-subtitle">Where your leads come from.</p></div>
      <button class="btn btn-primary" id="new-btn">+ New Source</button>
    </div>
    <div class="card" id="list"></div>
  `;
  document.getElementById("new-btn").addEventListener("click", () => openForm(document.getElementById("list")));
  await refresh(document.getElementById("list"));
}

main();
