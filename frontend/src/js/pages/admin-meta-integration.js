import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { metaApi, customFieldsApi } from "../api/resources.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatDateTime } from "../components/ui.js";

// §F/§I: CRM field keys a mapping may point to are either one of these
// three fixed core fields (mapped straight onto the lead) or one of the
// tenant's own active custom field definitions — nothing else.
const CORE_FIELDS = [
  { key: "name", label: "Name (core)" },
  { key: "phone", label: "Phone (core)" },
  { key: "email", label: "Email (core)" },
];

let customFields = [];

function crmFieldLabel(key) {
  const core = CORE_FIELDS.find((f) => f.key === key);
  if (core) return core.label;
  const cf = customFields.find((f) => f.field_key === key);
  return cf ? cf.label : key;
}

function crmFieldOptionsHtml(selected) {
  const groups = [
    `<optgroup label="Core fields">${CORE_FIELDS.map(
      (f) => `<option value="${f.key}" ${selected === f.key ? "selected" : ""}>${f.label}</option>`
    ).join("")}</optgroup>`,
  ];
  if (customFields.length) {
    groups.push(
      `<optgroup label="Custom fields">${customFields
        .map((f) => `<option value="${escapeHtml(f.field_key)}" ${selected === f.field_key ? "selected" : ""}>${escapeHtml(f.label)}</option>`)
        .join("")}</optgroup>`
    );
  }
  return groups.join("");
}

function openMappingForm(sectionEl, formId, mapping) {
  const isEdit = !!mapping;
  openModal({
    title: isEdit ? "Edit field mapping" : "New field mapping",
    bodyHtml: `
      <form id="mm-form" novalidate>
        <div class="field">
          <label class="label" for="mm-meta-key">Meta field key</label>
          <input class="input" id="mm-meta-key" value="${escapeHtml(mapping?.meta_field_key || "")}" placeholder="e.g. full_name" ${isEdit ? "disabled" : ""} />
          <span class="hint">The raw field name Meta sends for this form — check a real test submission, or the field name shown in Meta's Forms Library.</span>
        </div>
        <div class="field">
          <label class="label" for="mm-crm-key">CRM field</label>
          <select class="select" id="mm-crm-key">${crmFieldOptionsHtml(mapping?.crm_field_key)}</select>
          <span class="hint">Core fields go straight onto the lead. Anything else is stored in custom fields — create it on the Custom Fields page first if it's missing here.</span>
        </div>
        <div class="field-error" id="mm-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="mm-submit">${isEdit ? "Save changes" : "Add mapping"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#mm-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#mm-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const crmFieldKey = modalEl.querySelector("#mm-crm-key").value;

        try {
          if (isEdit) {
            await metaApi.updateMapping(mapping.id, { crmFieldKey });
          } else {
            const metaFieldKey = modalEl.querySelector("#mm-meta-key").value.trim();
            await metaApi.createMapping({ metaFormId: formId, metaFieldKey, crmFieldKey });
          }
          closeFn();
          toastSuccess(isEdit ? "Mapping updated." : "Mapping added.");
          await renderMappings(sectionEl, formId);
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

async function renderMappings(sectionEl, formId) {
  sectionEl.innerHTML = `<div class="divider"></div><div class="skeleton skeleton-row"></div>`;
  let mappings;
  try {
    ({ mappings } = await metaApi.mappings(formId));
  } catch (err) {
    sectionEl.innerHTML = `<div class="divider"></div>${emptyState({ icon: "⚠", title: "Couldn't load mappings", desc: err.message })}`;
    return;
  }

  sectionEl.innerHTML = `
    <div class="divider"></div>
    <div class="flex items-center justify-between">
      <h3 class="card-title">Field mapping — form ${escapeHtml(formId)}</h3>
      <button class="btn btn-primary btn-sm" id="add-mapping-btn">+ Add mapping</button>
    </div>
    <div id="mapping-list" class="mt-3"></div>
  `;

  const listEl = sectionEl.querySelector("#mapping-list");
  if (!mappings.length) {
    listEl.innerHTML = emptyState({
      icon: "⇄",
      title: "No field mappings yet",
      desc: "Map this form's Meta field keys (e.g. full_name, phone_number) to CRM fields. Any Meta field left unmapped is dropped when a lead comes in — never stored silently.",
    });
  } else {
    listEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Meta field key</th><th>CRM field</th><th></th></tr></thead>
          <tbody>
            ${mappings
              .map(
                (m) => `
              <tr>
                <td data-label="Meta field key" class="table-cell-primary">${escapeHtml(m.meta_field_key)}</td>
                <td data-label="CRM field">${escapeHtml(crmFieldLabel(m.crm_field_key))}</td>
                <td data-label="" class="flex gap-2">
                  <button class="btn btn-secondary btn-sm" data-edit="${m.id}">Edit</button>
                  <button class="btn btn-ghost btn-sm" data-remove="${m.id}">Remove</button>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;

    listEl.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => openMappingForm(sectionEl, formId, mappings.find((m) => String(m.id) === btn.dataset.edit)))
    );
    listEl.querySelectorAll("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Remove this mapping?",
          message: "New leads from this form will drop this field instead of storing it, until you add a new mapping.",
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        try {
          await metaApi.removeMapping(btn.dataset.remove);
          toastSuccess("Mapping removed.");
          await renderMappings(sectionEl, formId);
        } catch (err) {
          toastError(err.message);
        }
      })
    );
  }

  sectionEl.querySelector("#add-mapping-btn").addEventListener("click", () => openMappingForm(sectionEl, formId));
}

function selectForm(cardEl, formId) {
  renderMappings(cardEl.querySelector("#mapping-section"), formId);
}

function renderFormsCard(cardEl, connected) {
  if (!connected) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({
      icon: "▤",
      title: "Connect Meta first",
      desc: "Form discovery and field mapping become available once a Meta account is connected above.",
    })}</div>`;
    return;
  }

  cardEl.innerHTML = `
    <div class="card-body flex-col gap-4">
      <div class="flex items-center justify-between">
        <div>
          <span class="label">Meta Lead Ads forms on this Page</span>
          <p class="text-tertiary text-sm">Field mappings are configured per Meta form — load or pick a form to configure it.</p>
        </div>
        <button class="btn btn-secondary btn-sm" id="load-forms-btn">Load forms</button>
      </div>
      <div id="forms-list"></div>
      <div class="field">
        <label class="label" for="manual-form-id">Or enter a Meta form ID manually</label>
        <div class="flex gap-2">
          <input class="input" id="manual-form-id" placeholder="1234567890" style="flex:1" />
          <button class="btn btn-secondary" id="use-manual-form-btn">Use</button>
        </div>
      </div>
      <div id="mapping-section"></div>
    </div>`;

  cardEl.querySelector("#load-forms-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setButtonLoading(btn, true);
    const formsListEl = cardEl.querySelector("#forms-list");
    formsListEl.innerHTML = `<div class="skeleton skeleton-row"></div>`;
    try {
      const { forms } = await metaApi.forms();
      if (!forms.length) {
        formsListEl.innerHTML = `<p class="text-tertiary text-sm">No Lead Ads forms found for this Page yet.</p>`;
      } else {
        formsListEl.innerHTML = forms
          .map((f) => `<button class="btn btn-secondary btn-sm mr-2 mb-2" data-form-id="${escapeHtml(f.id)}">${escapeHtml(f.name || f.id)}</button>`)
          .join("");
        formsListEl.querySelectorAll("[data-form-id]").forEach((b) => b.addEventListener("click", () => selectForm(cardEl, b.dataset.formId)));
      }
    } catch (err) {
      formsListEl.innerHTML = "";
      toastError(err.message);
    } finally {
      setButtonLoading(btn, false);
    }
  });

  cardEl.querySelector("#use-manual-form-btn").addEventListener("click", () => {
    const id = cardEl.querySelector("#manual-form-id").value.trim();
    if (!id) return;
    selectForm(cardEl, id);
  });
}

async function renderConnectionCard(cardEl, onChange) {
  cardEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let connection;
  try {
    connection = await metaApi.connection();
  } catch (err) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load connection status", desc: err.message })}</div>`;
    return null;
  }

  const startConnect = async (btn) => {
    setButtonLoading(btn, true);
    try {
      const { authorizationUrl } = await metaApi.connect();
      // Full-page navigation to Meta's OAuth dialog — the Bearer token
      // stayed in the Authorization header for the /connect call above;
      // it has no business being in this URL (see meta.controller.js).
      window.location.href = authorizationUrl;
    } catch (err) {
      toastError(err.message);
      setButtonLoading(btn, false);
    }
  };

  if (!connection.connected) {
    cardEl.innerHTML = `
      <div class="card-body flex-col gap-4">
        ${emptyState({
          icon: "◈",
          title: "No Meta account connected",
          desc: "Connect a Facebook Page to start receiving Lead Ads submissions automatically.",
        })}
        <button class="btn btn-primary" id="connect-btn">Connect Meta</button>
      </div>`;
    cardEl.querySelector("#connect-btn").addEventListener("click", (e) => startConnect(e.currentTarget));
    return connection;
  }

  cardEl.innerHTML = `
    <div class="card-body flex-col gap-4">
      ${
        connection.isExpired
          ? `<div class="alert alert-warning"><span>⚠</span><span>Your Meta connection has expired or been revoked. Reconnect to keep receiving leads — your field mappings are kept.</span></div>`
          : ""
      }
      <div class="field-row">
        <div>
          <span class="label">Page</span>
          <p>${escapeHtml(connection.pageName || connection.pageId)}</p>
        </div>
        <div>
          <span class="label">Ad account</span>
          <p>${escapeHtml(connection.adAccountId || "—")}</p>
        </div>
        <div>
          <span class="label">Token expires</span>
          <p>${connection.tokenExpiresAt ? formatDateTime(connection.tokenExpiresAt) : "Not reported by Meta (no automatic refresh — see docs)"}</p>
        </div>
        <div>
          <span class="label">Status</span>
          <p><span class="badge ${connection.isExpired ? "badge-danger" : "badge-success"}">${connection.isExpired ? "Expired" : "Connected"}</span></p>
        </div>
      </div>
      <div class="flex gap-3">
        ${connection.isExpired ? `<button class="btn btn-primary" id="connect-btn">Reconnect</button>` : ""}
        <button class="btn btn-secondary" id="disconnect-btn">Disconnect</button>
      </div>
    </div>`;

  const connectBtn = cardEl.querySelector("#connect-btn");
  if (connectBtn) connectBtn.addEventListener("click", (e) => startConnect(e.currentTarget));

  cardEl.querySelector("#disconnect-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Disconnect Meta account?",
      message: "New Lead Ads submissions will stop being imported until you reconnect. Existing leads and field mappings are kept.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    try {
      await metaApi.disconnect();
      toastSuccess("Meta account disconnected.");
      onChange();
    } catch (err) {
      toastError(err.message);
    }
  });

  return connection;
}

async function main() {
  const user = await requireRole("tenant_admin");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "meta-integration", title: "Meta Lead Ads" });

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Meta Lead Ads</h2>
        <p class="page-subtitle">Connect a Facebook Page to import Lead Ads submissions automatically. Not a full ad-management tool — just enough to get leads into the CRM.</p>
      </div>
    </div>
    <div class="card mb-4" id="connection-card"></div>
    <div class="card" id="forms-card"></div>
  `;

  // §I: the OAuth callback (meta.controller.js oauthCallback) redirects
  // the browser back here with ?connected=true or ?error=... since it
  // can't hand results back any other way — surface it once, then strip
  // the query string so a reload doesn't re-show a stale toast.
  const params = new URLSearchParams(window.location.search);
  if (params.get("connected") === "true") {
    toastSuccess("Meta account connected.");
    history.replaceState(null, "", window.location.pathname);
  } else if (params.get("error")) {
    toastError(`Meta connection failed: ${params.get("error")}`);
    history.replaceState(null, "", window.location.pathname);
  }

  try {
    const { customFields: fields } = await customFieldsApi.list();
    // GET /api/custom-fields returns every definition, active or not —
    // but a mapping's crm_field_key must resolve to an ACTIVE definition
    // (see metaFormFieldMappingService.assertValidCrmFieldKey), so an
    // inactive one is filtered out here rather than offered and rejected.
    customFields = fields.filter((f) => f.is_active);
  } catch {
    customFields = [];
  }

  const connectionCard = document.getElementById("connection-card");
  const formsCard = document.getElementById("forms-card");

  const refresh = async () => {
    const connection = await renderConnectionCard(connectionCard, refresh);
    renderFormsCard(formsCard, !!connection?.connected && !connection?.isExpired);
  };

  await refresh();
}

main();
