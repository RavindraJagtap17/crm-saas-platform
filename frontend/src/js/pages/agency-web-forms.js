import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { webFormsApi, clientsApi } from "../api/resources.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading } from "../components/ui.js";

const FRONTEND_ORIGIN = window.location.origin;
const API_BASE_URL = window.CRM_CONFIG?.API_BASE_URL || "http://localhost:4000";

let clients = []; // this agency's own clients — the only ones selectable

function clientName(clientId) {
  return clients.find((c) => c.id === clientId)?.name || `Client #${clientId}`;
}

function embedSnippets(form) {
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
        desc: "Create one to get an embeddable script tag and iframe code for a client's website.",
      });
      return;
    }

    listEl.innerHTML = forms
      .map((form) => {
        const { scriptTag, iframeTag } = embedSnippets(form);
        return `
        <div class="card mb-4">
          <div class="card-header">
            <div>
              <h3 class="card-title">${escapeHtml(form.name)}</h3>
              <p class="card-subtitle">Client: ${escapeHtml(clientName(form.clientId))}</p>
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
      btn.addEventListener("click", () => openEditForm(listEl, forms.find((f) => String(f.id) === btn.dataset.edit)))
    );
  } catch (err) {
    listEl.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load website forms", desc: err.message });
  }
}

async function loadClientCustomFields(clientId) {
  if (!clientId) return [];
  try {
    const { customFields } = await webFormsApi.clientCustomFields(clientId);
    return customFields;
  } catch {
    return [];
  }
}

function customFieldsPreviewHtml(clientId, fields) {
  return `
    <div class="field">
      <span class="label">This client's active custom fields</span>
      <p class="hint mb-2">Included automatically on this form — not individually selectable. <a href="./custom-fields.html?clientId=${clientId}">Manage this client's custom fields →</a></p>
      ${
        fields.length
          ? `<div>${fields.map((f) => `<span class="badge badge-neutral mr-1 mb-1">${escapeHtml(f.label)}</span>`).join(" ")}</div>`
          : `<p class="text-tertiary text-sm">This client has no custom fields configured yet.</p>`
      }
    </div>`;
}

// Only name/allowed-domains/active/source/product are editable — clientId
// itself is deliberately not re-pointable after creation (matches the
// backend's own webFormService.update, which never accepts clientId).
function openEditForm(listEl, form) {
  const domainsValue = form.allowedDomains.join("\n");
  const { close } = openModal({
    title: "Edit website form",
    bodyHtml: `
      <form id="wf-form" novalidate>
        <div class="field">
          <label class="label" for="wf-name">Name</label>
          <input class="input" id="wf-name" value="${escapeHtml(form.name)}" placeholder="e.g. Homepage Contact Form" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="wf-source">Source</label>
            <select class="select" id="wf-source"><option>Loading…</option></select>
          </div>
          <div class="field">
            <label class="label" for="wf-product">Product <span class="optional">(optional)</span></label>
            <select class="select" id="wf-product"><option>Loading…</option></select>
          </div>
        </div>
        <div class="field">
          <label class="label" for="wf-domains">Allowed domains <span class="optional">(one per line)</span></label>
          <textarea class="textarea" id="wf-domains" placeholder="example.com&#10;www.example.com">${escapeHtml(domainsValue)}</textarea>
          <span class="hint">Bare hostnames only — no https:// or path. Required for the script embed; the iframe embed doesn't need this.</span>
        </div>
        <div class="checkbox-row"><input type="checkbox" id="wf-active" ${form.isActive ? "checked" : ""} /><label for="wf-active" class="text-sm">Active</label></div>
        <div class="field-error" id="wf-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="wf-submit">Save changes</button>`,
    onMount: async (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);

      const [{ sources }, { products }] = await Promise.all([
        clientsApi.leadSources(form.clientId),
        clientsApi.products(form.clientId),
      ]);
      modalEl.querySelector("#wf-source").innerHTML = sources
        .map((s) => `<option value="${s.id}" ${s.id === form.sourceId ? "selected" : ""}>${escapeHtml(s.name)}</option>`)
        .join("");
      modalEl.querySelector("#wf-product").innerHTML =
        `<option value="">None</option>` +
        products.map((p) => `<option value="${p.id}" ${p.id === form.productId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");

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
        try {
          await webFormsApi.update(form.id, {
            name: modalEl.querySelector("#wf-name").value.trim(),
            sourceId: Number(modalEl.querySelector("#wf-source").value),
            productId: modalEl.querySelector("#wf-product").value ? Number(modalEl.querySelector("#wf-product").value) : null,
            allowedDomains,
            isActive: modalEl.querySelector("#wf-active").checked,
          });
          closeFn();
          toastSuccess("Form updated.");
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

function openCreateForm(listEl) {
  const { close } = openModal({
    title: "New website form",
    bodyHtml: `
      <form id="wf-create-form" novalidate>
        <div class="field">
          <label class="label" for="wf-client">Client</label>
          <select class="select" id="wf-client">
            <option value="">Select a client…</option>
            ${clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div id="wf-client-body"></div>
        <div class="field-error" id="wf-create-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Close</button><button class="btn btn-primary" id="wf-create-submit" disabled>Create form</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      const bodySlot = modalEl.querySelector("#wf-client-body");
      const submitBtn = modalEl.querySelector("#wf-create-submit");
      let selectedClientId = null;

      modalEl.querySelector("#wf-client").addEventListener("change", async (e) => {
        selectedClientId = e.target.value ? Number(e.target.value) : null;
        submitBtn.disabled = true;
        if (!selectedClientId) {
          bodySlot.innerHTML = "";
          return;
        }
        bodySlot.innerHTML = `<div class="skeleton skeleton-row" style="width:70%"></div>`;
        const [{ sources }, { products }, customFields] = await Promise.all([
          clientsApi.leadSources(selectedClientId),
          clientsApi.products(selectedClientId),
          loadClientCustomFields(selectedClientId),
        ]);

        if (!sources.length) {
          bodySlot.innerHTML = emptyState({
            icon: "⌘",
            title: "This client has no lead sources yet",
            desc: "A website form needs a source to tag its leads with — ask this client's Client Admin to create one first.",
          });
          return;
        }

        bodySlot.innerHTML = `
          <div class="field">
            <label class="label" for="wf-name">Name</label>
            <input class="input" id="wf-name" placeholder="e.g. Homepage Contact Form" />
          </div>
          <div class="field-row">
            <div class="field">
              <label class="label" for="wf-source">Source</label>
              <select class="select" id="wf-source">
                ${sources.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label class="label" for="wf-product">Product <span class="optional">(optional)</span></label>
              <select class="select" id="wf-product">
                <option value="">None</option>
                ${products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="field">
            <label class="label" for="wf-domains">Allowed domains <span class="optional">(one per line)</span></label>
            <textarea class="textarea" id="wf-domains" placeholder="example.com&#10;www.example.com"></textarea>
            <span class="hint">Bare hostnames only — no https:// or path. Required for the script embed; the iframe embed doesn't need this.</span>
          </div>
          ${customFieldsPreviewHtml(selectedClientId, customFields)}
        `;
        submitBtn.disabled = false;
      });

      submitBtn.addEventListener("click", async () => {
        const errEl = modalEl.querySelector("#wf-create-error");
        errEl.hidden = true;
        if (!selectedClientId) return;
        setButtonLoading(submitBtn, true);
        const allowedDomains = (modalEl.querySelector("#wf-domains")?.value || "")
          .split(/\r?\n|,/)
          .map((d) => d.trim())
          .filter(Boolean);
        const productVal = modalEl.querySelector("#wf-product")?.value;
        try {
          await webFormsApi.create({
            name: modalEl.querySelector("#wf-name").value.trim(),
            clientId: selectedClientId,
            sourceId: Number(modalEl.querySelector("#wf-source").value),
            productId: productVal ? Number(productVal) : undefined,
            allowedDomains,
          });
          closeFn();
          toastSuccess("Form created.");
          refresh(listEl);
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = err.message;
        } finally {
          setButtonLoading(submitBtn, false);
        }
      });
    },
  });
  void close;
}

async function main() {
  const user = await requireRole("agency_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "web-forms", title: "Website Forms" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Website Forms</h2>
        <p class="page-subtitle">Embed a lead form on one of your clients' websites — submissions land in that client's CRM automatically.</p>
      </div>
      <button class="btn btn-primary" id="new-btn">+ New Form</button>
    </div>
    <div id="list"></div>
  `;

  try {
    ({ clients } = await clientsApi.list());
  } catch (err) {
    document.getElementById("list").innerHTML = emptyState({ title: "Couldn't load your clients", desc: err.message });
    return;
  }

  if (!clients.length) {
    document.getElementById("list").innerHTML = emptyState({
      icon: "◎",
      title: "Add a client first",
      desc: "A website form needs to target one of your clients.",
      actionHtml: `<a class="btn btn-secondary" href="./clients.html">Go to Clients</a>`,
    });
    document.getElementById("new-btn").disabled = true;
    return;
  }

  document.getElementById("new-btn").addEventListener("click", () => openCreateForm(document.getElementById("list")));
  await refresh(document.getElementById("list"));
}

main();
