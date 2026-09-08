import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { linkedinApi, customFieldsApi } from "../api/resources.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatDateTime } from "../components/ui.js";

// §F/§I: CRM field keys a mapping may point to are either one of these
// three fixed core fields or one of the Client's own active custom field
// definitions — identical set to Meta's own mapping form.
const CORE_FIELDS = [
  { key: "name", label: "Name (core)" },
  { key: "phone", label: "Phone (core)" },
  { key: "email", label: "Email (core)" },
];

const OWNER_TYPES = [
  { key: "organization", label: "Organization (Company Page)" },
  { key: "sponsoredAccount", label: "Sponsored (Ad) Account" },
];

// Backend error `code` values (linkedinLeadFormService.js) mapped to
// plain-language explanations — never shown as a raw code/stack to the
// Client Admin, never anything that could be a credential.
const ERROR_MESSAGES = {
  missing_params: "LinkedIn didn't return the expected authorization details. Please try connecting again.",
  LINKEDIN_STATE_INVALID: "This connection link expired or was already used. Please start over.",
  LINKEDIN_SUBSCRIPTION_FAILED: "LinkedIn accepted the sign-in but rejected the lead notification setup. Check that this account has Lead Sync API access, then try again.",
  LINKEDIN_OAUTH_ERROR: "LinkedIn couldn't complete the sign-in. Please try again.",
  LINKEDIN_UNREACHABLE: "Couldn't reach LinkedIn. Please try again shortly.",
  LINKEDIN_NOT_CONFIGURED: "LinkedIn integration isn't configured on this server yet. Contact support.",
  connection_failed: "The connection to LinkedIn failed. Please try again.",
  access_denied: "LinkedIn sign-in was cancelled.",
};
function friendlyOAuthError(code) {
  return ERROR_MESSAGES[code] || `LinkedIn connection failed (${code}). Please try again.`;
}

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
      <form id="lm-form" novalidate>
        <div class="field">
          <label class="label" for="lm-question-id">LinkedIn question ID</label>
          <input class="input" id="lm-question-id" value="${escapeHtml(mapping?.external_field_key || "")}" placeholder="e.g. 1" ${isEdit ? "disabled" : ""} />
          <span class="hint">The numeric Question ID LinkedIn sends for this form's answer — not the question's display text. Check Recent Events below for a real example after a test submission, or the form's details in LinkedIn Campaign Manager.</span>
        </div>
        <div class="field">
          <label class="label" for="lm-crm-key">CRM field</label>
          <select class="select" id="lm-crm-key">${crmFieldOptionsHtml(mapping?.crm_field_key)}</select>
          <span class="hint">Core fields go straight onto the lead. Anything else is stored in custom fields — create it on the Custom Fields page first if it's missing here.</span>
        </div>
        <div class="field-error" id="lm-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="lm-submit">${isEdit ? "Save changes" : "Add mapping"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#lm-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#lm-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const crmFieldKey = modalEl.querySelector("#lm-crm-key").value;

        try {
          if (isEdit) {
            await linkedinApi.updateMapping(mapping.id, { crmFieldKey });
          } else {
            const externalFieldKey = modalEl.querySelector("#lm-question-id").value.trim();
            if (!externalFieldKey) throw new Error("Enter the LinkedIn question ID.");
            await linkedinApi.createMapping({ externalFormId: formId, externalFieldKey, crmFieldKey });
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
    ({ mappings } = await linkedinApi.mappings(formId));
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
      desc: "Map this form's LinkedIn question IDs to CRM fields. Any question left unmapped is dropped when a lead comes in — never stored, and never blocks the lead from being created.",
    });
  } else {
    listEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Question ID</th><th>CRM field</th><th></th></tr></thead>
          <tbody>
            ${mappings
              .map(
                (m) => `
              <tr>
                <td data-label="Question ID" class="table-cell-primary">${escapeHtml(m.external_field_key)}</td>
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
          message: "New leads from this form will drop this question instead of storing it, until you add a new mapping.",
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        try {
          await linkedinApi.removeMapping(btn.dataset.remove);
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

const FORM_STATE_BADGE = { PUBLISHED: "badge-success", DRAFT: "badge-neutral", ARCHIVED: "badge-neutral" };

function renderFormsCard(cardEl, connected) {
  if (!connected) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({
      icon: "▤",
      title: "Connect LinkedIn first",
      desc: "Form discovery and field mapping become available once a LinkedIn account is connected above.",
    })}</div>`;
    return;
  }

  cardEl.innerHTML = `
    <div class="card-body flex-col gap-4">
      <div class="flex items-center justify-between">
        <div>
          <span class="label">LinkedIn Lead Gen Forms for this owner</span>
          <p class="text-tertiary text-sm">Field mappings are configured per form — load or pick a form to configure it.</p>
        </div>
        <button class="btn btn-secondary btn-sm" id="load-forms-btn">Load forms</button>
      </div>
      <div id="forms-list"></div>
      <div class="field">
        <label class="label" for="manual-form-id">Or enter a LinkedIn form ID manually</label>
        <div class="flex gap-2">
          <input class="input" id="manual-form-id" placeholder="e.g. 6851219773716516864" style="flex:1" />
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
      const { forms } = await linkedinApi.forms();
      if (!forms.length) {
        formsListEl.innerHTML = `<p class="text-tertiary text-sm">No Lead Gen Forms found for this owner yet.</p>`;
      } else {
        formsListEl.innerHTML = forms
          .map(
            (f) =>
              `<button class="btn btn-secondary btn-sm mr-2 mb-2" data-form-id="${escapeHtml(f.id)}">${escapeHtml(f.name || f.id)}${
                f.state ? ` <span class="badge ${FORM_STATE_BADGE[f.state] || "badge-neutral"}">${escapeHtml(f.state)}</span>` : ""
              }</button>`
          )
          .join("");
        formsListEl.querySelectorAll("[data-form-id]").forEach((b) => b.addEventListener("click", () => selectForm(cardEl, b.dataset.formId)));
      }
    } catch (err) {
      // A LinkedIn-side failure here (expired/revoked authorization, or
      // LinkedIn unreachable) has no other visible signal anywhere else in
      // this UI — surface it plainly rather than leaving an empty list.
      formsListEl.innerHTML = `${emptyState({ icon: "⚠", title: "Couldn't load forms", desc: err.message })}`;
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

function validateOwnerId(value) {
  return /^\d{1,32}$/.test(value.trim());
}

function ownerFormHtml(prefill) {
  return `
    <div class="field">
      <label class="label" for="li-owner-type">Owner type</label>
      <select class="select" id="li-owner-type">
        ${OWNER_TYPES.map((t) => `<option value="${t.key}" ${prefill?.ownerType === t.key ? "selected" : ""}>${t.label}</option>`).join("")}
      </select>
      <span class="hint">Whether the lead forms you want belong to a LinkedIn Company Page (Organization) or an advertising account (Sponsored/Ad Account).</span>
    </div>
    <div class="field">
      <label class="label" for="li-owner-id">Owner ID</label>
      <input class="input" id="li-owner-id" value="${escapeHtml(prefill?.ownerId || "")}" placeholder="e.g. 5509810" />
      <span class="hint">The numeric LinkedIn ID for that Company Page or ad account — find it in your Company Page admin URL (linkedin.com/company/&lt;id&gt;/admin) or in Campaign Manager's account settings. Not your page's vanity name or a campaign ID.</span>
    </div>
    <div class="field-error" id="li-owner-error" hidden></div>`;
}

async function startConnect(ownerFormEl, btn) {
  const errEl = ownerFormEl.querySelector("#li-owner-error");
  errEl.hidden = true;
  const ownerType = ownerFormEl.querySelector("#li-owner-type").value;
  const ownerId = ownerFormEl.querySelector("#li-owner-id").value.trim();
  if (!validateOwnerId(ownerId)) {
    errEl.hidden = false;
    errEl.textContent = "Owner ID must be the numeric LinkedIn ID (digits only).";
    return;
  }
  setButtonLoading(btn, true);
  try {
    const { authorizationUrl } = await linkedinApi.connect(ownerType, ownerId);
    // Full-page navigation to LinkedIn's OAuth dialog — same reasoning as
    // Meta's own connect flow (the Bearer token stays in the Authorization
    // header for the /connect call above, never in this URL).
    window.location.href = authorizationUrl;
  } catch (err) {
    errEl.hidden = false;
    errEl.textContent = err.message;
    setButtonLoading(btn, false);
  }
}

async function renderConnectionCard(cardEl, onChange) {
  cardEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let connection;
  try {
    connection = await linkedinApi.connection();
  } catch (err) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load connection status", desc: err.message })}</div>`;
    return null;
  }

  if (!connection.connected) {
    cardEl.innerHTML = `
      <div class="card-body flex-col gap-4">
        ${emptyState({
          icon: "◫",
          title: "No LinkedIn account connected",
          desc: "Connect a LinkedIn Company Page or ad account to start receiving Lead Gen Form submissions automatically.",
        })}
        <div id="owner-form">${ownerFormHtml()}</div>
        <button class="btn btn-primary" id="connect-btn">Connect LinkedIn</button>
      </div>`;
    cardEl.querySelector("#connect-btn").addEventListener("click", (e) => startConnect(cardEl.querySelector("#owner-form"), e.currentTarget));
    return connection;
  }

  const cfg = connection.config || {};
  const ownerTypeLabel = OWNER_TYPES.find((t) => t.key === cfg.ownerType)?.label || cfg.ownerType || "—";

  cardEl.innerHTML = `
    <div class="card-body flex-col gap-4">
      <div class="field-row">
        <div>
          <span class="label">Owner type</span>
          <p>${escapeHtml(ownerTypeLabel)}</p>
        </div>
        <div>
          <span class="label">Owner ID</span>
          <p>${escapeHtml(cfg.ownerId || "—")}</p>
        </div>
        <div>
          <span class="label">Lead type</span>
          <p>${escapeHtml(cfg.leadType || "—")}</p>
        </div>
        <div>
          <span class="label">Webhook</span>
          <p><span class="badge ${cfg.webhookValidated ? "badge-success" : "badge-warning"}">${
            cfg.webhookValidated ? "Verified by LinkedIn" : "Awaiting LinkedIn's verification (~2h)"
          }</span></p>
        </div>
        <div>
          <span class="label">Status</span>
          <p><span class="badge badge-success">Connected</span></p>
        </div>
      </div>
      <div class="flex gap-3">
        <button class="btn btn-secondary" id="reconnect-toggle-btn">Reconnect</button>
        <button class="btn btn-secondary" id="disconnect-btn">Disconnect</button>
      </div>
      <div id="reconnect-panel" hidden>
        <div class="divider"></div>
        <p class="text-tertiary text-sm mb-3">Re-authorize with LinkedIn — useful if leads have stopped arriving, or to point this connection at a different Company Page or ad account. Your existing field mappings are kept either way.</p>
        <div id="owner-form">${ownerFormHtml(cfg)}</div>
        <button class="btn btn-primary" id="reconnect-btn">Start reconnect</button>
      </div>
    </div>`;

  cardEl.querySelector("#reconnect-toggle-btn").addEventListener("click", () => {
    const panel = cardEl.querySelector("#reconnect-panel");
    panel.hidden = !panel.hidden;
  });
  cardEl.querySelector("#reconnect-btn").addEventListener("click", (e) => startConnect(cardEl.querySelector("#reconnect-panel #owner-form"), e.currentTarget));

  cardEl.querySelector("#disconnect-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Disconnect LinkedIn account?",
      message: "New Lead Gen Form submissions will stop being imported until you reconnect. Existing leads and field mappings are kept.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    try {
      await linkedinApi.disconnect();
      toastSuccess("LinkedIn account disconnected.");
      onChange();
    } catch (err) {
      toastError(err.message);
    }
  });

  return connection;
}

const EVENT_STATUS_BADGE = {
  received: "badge-neutral",
  processing: "badge-neutral",
  processed: "badge-success",
  duplicate: "badge-neutral",
  failed: "badge-danger",
};
const EVENT_STATUS_LABEL = {
  received: "Received",
  processing: "Processing",
  processed: "Processed",
  duplicate: "Duplicate",
  failed: "Failed",
};

async function renderEventsCard(cardEl) {
  cardEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let events;
  try {
    ({ events } = await linkedinApi.events(50));
  } catch (err) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load recent events", desc: err.message })}</div>`;
    return;
  }

  if (!events.length) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({
      icon: "⇪",
      title: "No LinkedIn events yet",
      desc: "When LinkedIn delivers a Lead Gen Form submission, it will show up here — whether it was successfully turned into a lead or not.",
    })}</div>`;
    return;
  }

  cardEl.innerHTML = `
    <div class="table-wrap" style="border:none;border-radius:0">
      <table class="data-table">
        <thead><tr><th>Received</th><th>External lead ID</th><th>Status</th><th>CRM lead</th><th>Error</th></tr></thead>
        <tbody>
          ${events
            .map(
              (ev) => `
            <tr>
              <td data-label="Received">${formatDateTime(ev.receivedAt)}</td>
              <td data-label="External lead ID"><code class="text-sm" title="${escapeHtml(ev.externalLeadId)}">${escapeHtml(
                ev.externalLeadId.length > 40 ? `${ev.externalLeadId.slice(0, 40)}…` : ev.externalLeadId
              )}</code></td>
              <td data-label="Status"><span class="badge ${EVENT_STATUS_BADGE[ev.status] || "badge-neutral"}">${
                EVENT_STATUS_LABEL[ev.status] || ev.status
              }</span>${ev.status === "failed" && ev.attempts ? ` <span class="text-tertiary text-sm">(${ev.attempts} attempt${ev.attempts === 1 ? "" : "s"})</span>` : ""}</td>
              <td data-label="CRM lead">${ev.crmLeadId ? `<a href="./lead-detail.html?id=${ev.crmLeadId}">#${ev.crmLeadId}</a>` : "—"}</td>
              <td data-label="Error" class="text-sm text-tertiary">${ev.lastError ? escapeHtml(ev.lastError) : "—"}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

async function main() {
  const user = await requireRole("client_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "linkedin-integration", title: "LinkedIn Lead Gen Forms" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">LinkedIn Lead Gen Forms</h2>
        <p class="page-subtitle">Connect a LinkedIn Company Page or ad account to import Lead Gen Form submissions automatically. Not a full ad-management tool — just enough to get leads into the CRM.</p>
      </div>
    </div>
    <div class="card mb-4" id="connection-card"></div>
    <div class="card mb-4" id="forms-card"></div>
    <div class="page-header">
      <div>
        <h3 class="page-title" style="font-size:1.1rem">Recent events</h3>
        <p class="page-subtitle">Every Lead Gen Form submission LinkedIn has delivered, whether it became a lead or not.</p>
      </div>
    </div>
    <div class="card" id="events-card"></div>
  `;

  // The OAuth callback (linkedinLeadForm.controller.js oauthCallback)
  // redirects the browser back here with ?connected=true or ?error=...
  // since it can't hand results back any other way — surface it once,
  // then strip the query string so a reload doesn't re-show a stale toast.
  const params = new URLSearchParams(window.location.search);
  if (params.get("connected") === "true") {
    toastSuccess("LinkedIn account connected.");
    history.replaceState(null, "", window.location.pathname);
  } else if (params.get("error")) {
    toastError(friendlyOAuthError(params.get("error")));
    history.replaceState(null, "", window.location.pathname);
  }

  try {
    const { customFields: fields } = await customFieldsApi.list();
    // A mapping's crm_field_key must resolve to an ACTIVE definition (see
    // integrationFieldMappingService.assertValidCrmFieldKey) — an inactive
    // one is filtered out here rather than offered and rejected.
    customFields = fields.filter((f) => f.is_active);
  } catch {
    customFields = [];
  }

  const connectionCard = document.getElementById("connection-card");
  const formsCard = document.getElementById("forms-card");
  const eventsCard = document.getElementById("events-card");

  const refresh = async () => {
    const connection = await renderConnectionCard(connectionCard, refresh);
    renderFormsCard(formsCard, !!connection?.connected);
  };

  await refresh();
  await renderEventsCard(eventsCard);
}

main();
