import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { webFormsApi, leadSourcesApi, productsApi } from "../api/resources.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading } from "../components/ui.js";

const FRONTEND_ORIGIN = window.location.origin;
const API_BASE_URL = window.CRM_CONFIG?.API_BASE_URL || "http://localhost:4000";

let refData = null; // { sources, products }

function embedSnippets(form) {
  // The widget .js file is a static frontend asset (served from
  // FRONTEND_ORIGIN), but frontend and backend are separate origins in
  // this architecture (documented throughout — api.* vs app.*), so the
  // widget can't assume its API lives on the same origin it was loaded
  // from. data-api-base tells it explicitly rather than guessing wrong.
  const scriptTag = `<script src="${FRONTEND_ORIGIN}/public/embed/crm-lead-widget.js" data-form-key="${form.formKey}" data-api-base="${API_BASE_URL}"><\/script>`;
  const iframeTag = `<iframe src="${FRONTEND_ORIGIN}/public/embed/lead-form.html?formKey=${form.formKey}" width="100%" height="520" style="border:0"></iframe>`;
  return { scriptTag, iframeTag };
}

async function refresh(listEl) {
  listEl.innerHTML = `<div class="skeleton skeleton-row"></div>`;
  try {
    const { forms } = await webFormsApi.list();
    if (!forms.length) {
      listEl.innerHTML = emptyState({
        icon: "⌗",
        title: "No website forms yet",
        desc: "Create one to get an embeddable script tag and iframe code for your website.",
      });
      return;
    }
    const sourceById = new Map(refData.sources.map((s) => [s.id, s]));
    const productById = new Map(refData.products.map((p) => [p.id, p]));

    listEl.innerHTML = forms
      .map((form) => {
        const { scriptTag, iframeTag } = embedSnippets(form);
        return `
        <div class="card mb-4">
          <div class="card-header">
            <div>
              <h3 class="card-title">${escapeHtml(form.name)}</h3>
              <p class="card-subtitle">
                Source: ${escapeHtml(sourceById.get(form.sourceId)?.name || "—")}
                ${form.productId ? " · Product: " + escapeHtml(productById.get(form.productId)?.name || "—") : ""}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span class="badge ${form.isActive ? "badge-success" : "badge-neutral"}">${form.isActive ? "Active" : "Inactive"}</span>
              <button class="btn btn-secondary btn-sm" data-edit="${form.id}">Edit</button>
            </div>
          </div>
          <div class="card-body flex-col gap-4">
            <div>
              <span class="label">Allowed domains</span>
              <div class="mt-2">
                ${
                  form.allowedDomains.length
                    ? form.allowedDomains.map((d) => `<span class="badge badge-neutral mr-1">${escapeHtml(d)}</span>`).join(" ")
                    : `<span class="text-tertiary text-sm">None yet — script embed will be rejected until you add one. Iframe embed works without it.</span>`
                }
              </div>
            </div>
            <div>
              <span class="label">Script embed</span>
              <pre class="code mt-2" style="white-space:pre-wrap;word-break:break-all">${escapeHtml(scriptTag)}</pre>
            </div>
            <div>
              <span class="label">Iframe embed</span>
              <pre class="code mt-2" style="white-space:pre-wrap;word-break:break-all">${escapeHtml(iframeTag)}</pre>
            </div>
          </div>
        </div>`;
      })
      .join("");

    listEl.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => openForm(listEl, forms.find((f) => String(f.id) === btn.dataset.edit)))
    );
  } catch (err) {
    listEl.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load website forms", desc: err.message });
  }
}

function openForm(listEl, form) {
  const isEdit = !!form;
  const domainsValue = form ? form.allowedDomains.join("\n") : "";

  openModal({
    title: isEdit ? "Edit website form" : "New website form",
    bodyHtml: `
      <form id="wf-form" novalidate>
        <div class="field">
          <label class="label" for="wf-name">Name</label>
          <input class="input" id="wf-name" value="${escapeHtml(form?.name || "")}" placeholder="e.g. Homepage Contact Form" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="wf-source">Source</label>
            <select class="select" id="wf-source">
              ${refData.sources.map((s) => `<option value="${s.id}" ${form?.sourceId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label class="label" for="wf-product">Product <span class="optional">(optional)</span></label>
            <select class="select" id="wf-product">
              <option value="">None</option>
              ${refData.products.map((p) => `<option value="${p.id}" ${form?.productId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="label" for="wf-domains">Allowed domains <span class="optional">(one per line)</span></label>
          <textarea class="textarea" id="wf-domains" placeholder="example.com&#10;www.example.com">${escapeHtml(domainsValue)}</textarea>
          <span class="hint">Bare hostnames only — no https:// or path. Required for the script embed; the iframe embed doesn't need this.</span>
        </div>
        ${
          isEdit
            ? `<div class="checkbox-row"><input type="checkbox" id="wf-active" ${form.isActive ? "checked" : ""} /><label for="wf-active" class="text-sm">Active</label></div>`
            : ""
        }
        <div class="field-error" id="wf-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="wf-submit">${isEdit ? "Save changes" : "Create form"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#wf-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#wf-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);

        const allowedDomains = modalEl
          .querySelector("#wf-domains")
          .value.split(/\r?\n|,/)
          .map((d) => d.trim())
          .filter(Boolean);

        const body = {
          name: modalEl.querySelector("#wf-name").value.trim(),
          sourceId: Number(modalEl.querySelector("#wf-source").value),
          productId: modalEl.querySelector("#wf-product").value ? Number(modalEl.querySelector("#wf-product").value) : null,
          allowedDomains,
          ...(isEdit ? { isActive: modalEl.querySelector("#wf-active").checked } : {}),
        };

        try {
          if (isEdit) await webFormsApi.update(form.id, body);
          else await webFormsApi.create(body);
          closeFn();
          toastSuccess(isEdit ? "Form updated." : "Form created.");
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
  const content = mountShell({ activeKey: "web-forms", title: "Website Forms" });

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Website Forms</h2>
        <p class="page-subtitle">Embed a lead form on your website — submissions land here automatically.</p>
      </div>
      <button class="btn btn-primary" id="new-btn">+ New Form</button>
    </div>
    <div id="list"></div>
  `;

  try {
    const [sources, products] = await Promise.all([
      leadSourcesApi.list().then((r) => r.sources),
      productsApi.list(true).then((r) => r.products),
    ]);
    refData = { sources, products };
  } catch (err) {
    document.getElementById("list").innerHTML = emptyState({ title: "Couldn't load setup data", desc: err.message });
    return;
  }

  if (!refData.sources.length) {
    document.getElementById("list").innerHTML = emptyState({
      icon: "⌘",
      title: "Create a lead source first",
      desc: "A website form needs a source to tag its leads with — set one up on the Lead Sources page.",
      actionHtml: `<a class="btn btn-secondary" href="./sources.html">Go to Lead Sources</a>`,
    });
    document.getElementById("new-btn").disabled = true;
    return;
  }

  document.getElementById("new-btn").addEventListener("click", () => openForm(document.getElementById("list")));
  await refresh(document.getElementById("list"));
}

main();
