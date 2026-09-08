import { requireRole, API_BASE_URL } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { googleAdsApi, customFieldsApi } from "../api/resources.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatDateTime } from "../components/ui.js";

// §F/§I: CRM field keys a mapping may point to are either one of these
// three fixed core fields or one of the Client's own active custom field
// definitions — identical set to Meta's/LinkedIn's own mapping forms.
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

async function copyToClipboard(value, btn) {
  try {
    await navigator.clipboard.writeText(value);
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  } catch {
    toastError("Couldn't copy — select and copy the value manually.");
  }
}

function openMappingForm(sectionEl, formId, mapping) {
  const isEdit = !!mapping;
  openModal({
    title: isEdit ? "Edit field mapping" : "New field mapping",
    bodyHtml: `
      <form id="gm-form" novalidate>
        <div class="field">
          <label class="label" for="gm-column-id">Google column ID</label>
          <input class="input" id="gm-column-id" value="${escapeHtml(mapping?.external_field_key || "")}" placeholder="e.g. FULL_NAME or a custom question's column_id" ${isEdit ? "disabled" : ""} />
          <span class="hint">The raw column_id Google sends for this field — check a real test submission (Recent Events below) or the field name shown when you built the lead form in Google Ads.</span>
        </div>
        <div class="field">
          <label class="label" for="gm-crm-key">CRM field</label>
          <select class="select" id="gm-crm-key">${crmFieldOptionsHtml(mapping?.crm_field_key)}</select>
          <span class="hint">Core fields go straight onto the lead. Anything else is stored in custom fields — create it on the Custom Fields page first if it's missing here.</span>
        </div>
        <div class="field-error" id="gm-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="gm-submit">${isEdit ? "Save changes" : "Add mapping"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#gm-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#gm-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const crmFieldKey = modalEl.querySelector("#gm-crm-key").value;

        try {
          if (isEdit) {
            await googleAdsApi.updateMapping(mapping.id, { crmFieldKey });
          } else {
            const externalFieldKey = modalEl.querySelector("#gm-column-id").value.trim();
            if (!externalFieldKey) throw new Error("Enter the Google column ID.");
            await googleAdsApi.createMapping({ externalFormId: formId, externalFieldKey, crmFieldKey });
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
    ({ mappings } = await googleAdsApi.mappings(formId));
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
      desc: "Map this form's Google column IDs to CRM fields. Any column left unmapped is dropped when a lead comes in — never stored, and never blocks the lead from being created.",
    });
  } else {
    listEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Column ID</th><th>CRM field</th><th></th></tr></thead>
          <tbody>
            ${mappings
              .map(
                (m) => `
              <tr>
                <td data-label="Column ID" class="table-cell-primary">${escapeHtml(m.external_field_key)}</td>
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
          message: "New leads from this form will drop this column instead of storing it, until you add a new mapping.",
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        try {
          await googleAdsApi.removeMapping(btn.dataset.remove);
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
      title: "Connect Google Ads first",
      desc: "Field mapping becomes available once a Google Ads webhook is connected above.",
    })}</div>`;
    return;
  }

  cardEl.innerHTML = `
    <div class="card-body flex-col gap-4">
      <div>
        <span class="label">Field mapping</span>
        <p class="text-tertiary text-sm">Google's Lead Form webhook doesn't offer a way to list your forms from here — enter the numeric form ID from Google Ads (Ads &amp; assets → Lead form assets) to configure its mapping.</p>
      </div>
      <div class="field">
        <label class="label" for="manual-form-id">Google form ID</label>
        <div class="flex gap-2">
          <input class="input" id="manual-form-id" placeholder="e.g. 12345678901" style="flex:1" />
          <button class="btn btn-secondary" id="use-manual-form-btn">Use</button>
        </div>
      </div>
      <div id="mapping-section"></div>
    </div>`;

  cardEl.querySelector("#use-manual-form-btn").addEventListener("click", () => {
    const id = cardEl.querySelector("#manual-form-id").value.trim();
    if (!id) return;
    selectForm(cardEl, id);
  });
}

// Shown exactly once, immediately after a successful connect/regenerate —
// the plaintext key is never retrievable again afterward (getConnection
// never decrypts it back out, see googleLeadFormService.getConnection).
function renderCredentialsReveal(cardEl, { webhookUrl, webhookKey }, onDone) {
  cardEl.innerHTML = `
    <div class="card-body flex-col gap-4">
      <div class="alert alert-warning"><span>⚠</span><span>Save this key now — it will not be shown again. Paste both values into Google Ads under Ads &amp; assets → Lead form assets → Webhook delivery for each form you want to send leads from.</span></div>
      <div class="field">
        <label class="label" for="reveal-webhook-url">Webhook URL</label>
        <div class="flex gap-2">
          <input class="input" id="reveal-webhook-url" value="${escapeHtml(webhookUrl)}" readonly style="flex:1" />
          <button class="btn btn-secondary" id="copy-url-btn">Copy</button>
        </div>
      </div>
      <div class="field">
        <label class="label" for="reveal-webhook-key">Webhook key</label>
        <div class="flex gap-2">
          <input class="input" id="reveal-webhook-key" value="${escapeHtml(webhookKey)}" readonly style="flex:1" />
          <button class="btn btn-secondary" id="copy-key-btn">Copy</button>
        </div>
      </div>
      <button class="btn btn-primary" id="reveal-done-btn">I've saved these — done</button>
    </div>`;

  cardEl.querySelector("#copy-url-btn").addEventListener("click", (e) => copyToClipboard(webhookUrl, e.currentTarget));
  cardEl.querySelector("#copy-key-btn").addEventListener("click", (e) => copyToClipboard(webhookKey, e.currentTarget));
  cardEl.querySelector("#reveal-done-btn").addEventListener("click", onDone);
}

async function runConnect(cardEl, btn, onChange) {
  setButtonLoading(btn, true);
  try {
    const result = await googleAdsApi.connect();
    renderCredentialsReveal(cardEl, result, onChange);
  } catch (err) {
    toastError(err.message);
    setButtonLoading(btn, false);
  }
}

async function renderConnectionCard(cardEl, onChange) {
  cardEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let connection;
  try {
    connection = await googleAdsApi.connection();
  } catch (err) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load connection status", desc: err.message })}</div>`;
    return null;
  }

  if (!connection.connected) {
    cardEl.innerHTML = `
      <div class="card-body flex-col gap-4">
        ${emptyState({
          icon: "▧",
          title: "No Google Ads webhook connected",
          desc: "Connecting mints a webhook URL and a secret key for this Client — you'll paste both into Google Ads yourself, per lead form, to start receiving submissions.",
        })}
        <button class="btn btn-primary" id="connect-btn">Connect Google Ads</button>
      </div>`;
    cardEl.querySelector("#connect-btn").addEventListener("click", (e) => runConnect(cardEl, e.currentTarget, onChange));
    return connection;
  }

  // externalAccountId is an opaque routing token, not a secret — it's
  // embedded in the (public) webhook URL itself, so reconstructing and
  // showing that URL again on every load is safe. The key itself is
  // never re-shown; see renderCredentialsReveal's own comment.
  const webhookUrl = `${API_BASE_URL}/api/integrations/google/webhook/${connection.externalAccountId}`;

  cardEl.innerHTML = `
    <div class="card-body flex-col gap-4">
      <div class="field-row">
        <div>
          <span class="label">Status</span>
          <p><span class="badge badge-success">Connected</span></p>
        </div>
        <div>
          <span class="label">Connected</span>
          <p>${formatDateTime(connection.connectedAt)}</p>
        </div>
      </div>
      <div class="field">
        <label class="label" for="conn-webhook-url">Webhook URL</label>
        <div class="flex gap-2">
          <input class="input" id="conn-webhook-url" value="${escapeHtml(webhookUrl)}" readonly style="flex:1" />
          <button class="btn btn-secondary" id="copy-conn-url-btn">Copy</button>
        </div>
        <span class="hint">The webhook key isn't shown here — it was only ever displayed once, right after connecting. If it's lost or may have leaked, regenerate below (this replaces both values and requires updating Google Ads again).</span>
      </div>
      <div class="flex gap-3">
        <button class="btn btn-secondary" id="regenerate-btn">Regenerate credentials</button>
        <button class="btn btn-secondary" id="disconnect-btn">Disconnect</button>
      </div>
    </div>`;

  cardEl.querySelector("#copy-conn-url-btn").addEventListener("click", (e) => copyToClipboard(webhookUrl, e.currentTarget));

  cardEl.querySelector("#regenerate-btn").addEventListener("click", async (e) => {
    const ok = await confirmDialog({
      title: "Regenerate webhook credentials?",
      message: "This immediately invalidates the current webhook URL and key — Google will no longer be able to deliver leads until you update every lead form in Google Ads with the new values. Existing field mappings are kept.",
      confirmLabel: "Regenerate",
      danger: true,
    });
    if (!ok) return;
    await runConnect(cardEl, e.currentTarget, onChange);
  });

  cardEl.querySelector("#disconnect-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Disconnect Google Ads?",
      message: "New Lead Form submissions will stop being imported until you reconnect. Existing leads and field mappings are kept.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    try {
      await googleAdsApi.disconnect();
      toastSuccess("Google Ads webhook disconnected.");
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

// Integration event recovery & operational hardening — a Client Admin
// should be able to tell "stuck or repeatedly failing" apart from
// "normal" without database access (attempts/nextAttemptAt were already
// returned by the API; this is the first place either is actually shown).
// A 'received' row with attempts > 0 was reset by the stale-processing
// sweep after getting stuck — not a fabricated status, just surfacing
// what already happened.
function eventStatusDetail(ev) {
  if (ev.status === "failed" && ev.attempts) {
    const next = ev.nextAttemptAt ? `, next retry ${formatDateTime(ev.nextAttemptAt)}` : "";
    return ` <span class="text-tertiary text-sm">(${ev.attempts} attempt${ev.attempts === 1 ? "" : "s"}${next})</span>`;
  }
  if (ev.status === "received" && ev.attempts) {
    return ` <span class="text-tertiary text-sm">(recovered — ${ev.attempts} prior attempt${ev.attempts === 1 ? "" : "s"})</span>`;
  }
  return "";
}

async function renderEventsCard(cardEl) {
  cardEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let events;
  try {
    ({ events } = await googleAdsApi.events(50));
  } catch (err) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load recent events", desc: err.message })}</div>`;
    return;
  }

  if (!events.length) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({
      icon: "⇪",
      title: "No Google Ads events yet",
      desc: "When Google delivers a Lead Form submission, it will show up here — whether it was successfully turned into a lead or not.",
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
              <td data-label="External lead ID"><code class="text-sm">${escapeHtml(ev.externalLeadId)}</code></td>
              <td data-label="Status"><span class="badge ${EVENT_STATUS_BADGE[ev.status] || "badge-neutral"}">${
                EVENT_STATUS_LABEL[ev.status] || ev.status
              }</span>${eventStatusDetail(ev)}</td>
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
  const content = mountShell({ activeKey: "google-integration", title: "Google Ads Lead Forms" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Google Ads Lead Forms</h2>
        <p class="page-subtitle">Connect Google Ads' Lead Form webhook to import submissions automatically. Not a full ad-management tool — just enough to get leads into the CRM.</p>
      </div>
    </div>
    <div class="card mb-4" id="connection-card"></div>
    <div class="card mb-4" id="forms-card"></div>
    <div class="page-header">
      <div>
        <h3 class="page-title" style="font-size:1.1rem">Recent events</h3>
        <p class="page-subtitle">Every Lead Form submission Google has delivered, whether it became a lead or not.</p>
      </div>
    </div>
    <div class="card" id="events-card"></div>
  `;

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
