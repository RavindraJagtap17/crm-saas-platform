import { requireRole, API_BASE_URL } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { indiamartApi, customFieldsApi } from "../api/resources.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatDateTime } from "../components/ui.js";

// §F/§I: CRM field keys a mapping may point to are either one of these
// three fixed core fields or one of the Client's own active custom field
// definitions — identical set to every other provider's mapping form.
const CORE_FIELDS = [
  { key: "name", label: "Name (core)" },
  { key: "phone", label: "Phone (core)" },
  { key: "email", label: "Email (core)" },
];

// The exact, fixed field set IndiaMART's Push API sends (confirmed against
// a real, literal sample payload during the discovery audit — see
// indiamartLeadFormService.js's own MAPPABLE_FIELD_KEYS, which this list
// mirrors exactly). Unlike Meta/Google/LinkedIn, IndiaMART's fields are a
// closed, known set rather than an admin-defined form schema, so this is
// offered as a select instead of a free-text "guess the raw key" input —
// a real UX improvement grounded in verified data, not a guess.
const INDIAMART_FIELDS = [
  { key: "SENDER_NAME", label: "Sender name" },
  { key: "SENDER_MOBILE", label: "Mobile" },
  { key: "SENDER_MOBILE_ALT", label: "Mobile (alternate)" },
  { key: "SENDER_EMAIL", label: "Email" },
  { key: "SENDER_EMAIL_ALT", label: "Email (alternate)" },
  { key: "SENDER_PHONE", label: "Phone (landline)" },
  { key: "SENDER_PHONE_ALT", label: "Phone (landline, alternate)" },
  { key: "SENDER_COMPANY", label: "Company" },
  { key: "SENDER_ADDRESS", label: "Address" },
  { key: "SENDER_CITY", label: "City" },
  { key: "SENDER_STATE", label: "State" },
  { key: "SENDER_PINCODE", label: "Pincode" },
  { key: "SENDER_COUNTRY_ISO", label: "Country (ISO code)" },
  { key: "SUBJECT", label: "Subject" },
  { key: "QUERY_PRODUCT_NAME", label: "Product name" },
  { key: "QUERY_MESSAGE", label: "Message" },
  { key: "QUERY_MCAT_NAME", label: "Product category" },
  { key: "CALL_DURATION", label: "Call duration (call enquiries only)" },
  { key: "RECEIVER_MOBILE", label: "Receiver mobile (call enquiries only)" },
];
function indiamartFieldLabel(key) {
  return INDIAMART_FIELDS.find((f) => f.key === key)?.label || key;
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

function openMappingForm(sectionEl, mapping) {
  const isEdit = !!mapping;
  openModal({
    title: isEdit ? "Edit field mapping" : "New field mapping",
    bodyHtml: `
      <form id="im-form" novalidate>
        <div class="field">
          <label class="label" for="im-field-key">IndiaMART field</label>
          <select class="select" id="im-field-key" ${isEdit ? "disabled" : ""}>
            ${INDIAMART_FIELDS.map((f) => `<option value="${f.key}" ${mapping?.external_field_key === f.key ? "selected" : ""}>${f.label}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label class="label" for="im-crm-key">CRM field</label>
          <select class="select" id="im-crm-key">${crmFieldOptionsHtml(mapping?.crm_field_key)}</select>
          <span class="hint">Core fields go straight onto the lead. Anything else is stored in custom fields — create it on the Custom Fields page first if it's missing here.</span>
        </div>
        <div class="field-error" id="im-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="im-submit">${isEdit ? "Save changes" : "Add mapping"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#im-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#im-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const crmFieldKey = modalEl.querySelector("#im-crm-key").value;

        try {
          if (isEdit) {
            await indiamartApi.updateMapping(mapping.id, { crmFieldKey });
          } else {
            const externalFieldKey = modalEl.querySelector("#im-field-key").value;
            // IndiaMART has no form concept — every mapping lives under the
            // one fixed "default" form id (see indiamartLeadFormService.js).
            await indiamartApi.createMapping({ externalFormId: "default", externalFieldKey, crmFieldKey });
          }
          closeFn();
          toastSuccess(isEdit ? "Mapping updated." : "Mapping added.");
          await renderMappings(sectionEl);
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

async function renderMappings(sectionEl) {
  sectionEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let mappings;
  try {
    ({ mappings } = await indiamartApi.mappings());
  } catch (err) {
    sectionEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load mappings", desc: err.message })}</div>`;
    return;
  }

  sectionEl.innerHTML = `
    <div class="card-body flex-col gap-4">
      <div class="flex items-center justify-between">
        <div>
          <span class="label">Field mapping</span>
          <p class="text-tertiary text-sm">IndiaMART's fields are fixed — map the ones you want onto your CRM fields below. There's no per-form setup here, unlike other providers: one mapping list covers every lead IndiaMART sends.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="add-mapping-btn">+ Add mapping</button>
      </div>
      <div id="mapping-list"></div>
    </div>`;

  const listEl = sectionEl.querySelector("#mapping-list");
  if (!mappings.length) {
    listEl.innerHTML = emptyState({
      icon: "⇄",
      title: "No field mappings yet",
      desc: "Map IndiaMART's fields (sender name, mobile, email, and so on) to CRM fields. Any field left unmapped is dropped when a lead comes in — never stored, and never blocks the lead from being created.",
    });
  } else {
    listEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>IndiaMART field</th><th>CRM field</th><th></th></tr></thead>
          <tbody>
            ${mappings
              .map(
                (m) => `
              <tr>
                <td data-label="IndiaMART field" class="table-cell-primary">${escapeHtml(indiamartFieldLabel(m.external_field_key))}</td>
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
      btn.addEventListener("click", () => openMappingForm(sectionEl, mappings.find((m) => String(m.id) === btn.dataset.edit)))
    );
    listEl.querySelectorAll("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Remove this mapping?",
          message: "New leads will drop this field instead of storing it, until you add a new mapping.",
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        try {
          await indiamartApi.removeMapping(btn.dataset.remove);
          toastSuccess("Mapping removed.");
          await renderMappings(sectionEl);
        } catch (err) {
          toastError(err.message);
        }
      })
    );
  }

  sectionEl.querySelector("#add-mapping-btn").addEventListener("click", () => openMappingForm(sectionEl));
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

async function runConnect(btn, onChange) {
  setButtonLoading(btn, true);
  try {
    await indiamartApi.connect();
    toastSuccess("Webhook URL generated — one more step needed on IndiaMART's own dashboard (see below).");
    onChange();
  } catch (err) {
    toastError(err.message);
    setButtonLoading(btn, false);
  }
}

async function renderConnectionCard(cardEl, onChange) {
  cardEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let connection;
  try {
    connection = await indiamartApi.connection();
  } catch (err) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load connection status", desc: err.message })}</div>`;
    return null;
  }

  if (!connection.connected) {
    cardEl.innerHTML = `
      <div class="card-body flex-col gap-4">
        ${emptyState({
          icon: "◨",
          title: "No IndiaMART webhook connected",
          desc: "Connecting mints a webhook URL for this Client. IndiaMART's Push API needs no key or credential — you'll register the URL yourself on your IndiaMART seller dashboard to finish setup.",
        })}
        <button class="btn btn-primary" id="connect-btn">Connect IndiaMART</button>
      </div>`;
    cardEl.querySelector("#connect-btn").addEventListener("click", (e) => runConnect(e.currentTarget, onChange));
    return connection;
  }

  // externalAccountId is the routing token minted for this connection —
  // not a secret in the way Google's shared key is (IndiaMART's Push API
  // has no key at all, see indiamartLeadFormService.js's own comment), so
  // it's safe to reconstruct and display on every load, unlike a credential.
  const webhookUrl = `${API_BASE_URL}/api/integrations/indiamart/webhook/${connection.externalAccountId}`;

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
      <div class="alert alert-warning"><span>⚠</span><span>IndiaMART automatically deactivates this webhook if it goes 48 continuous hours without a successful delivery. If leads stop arriving, check Recent Events below for errors before assuming nothing's wrong.</span></div>
      <div class="field">
        <label class="label" for="conn-webhook-url">Webhook URL</label>
        <div class="flex gap-2">
          <input class="input" id="conn-webhook-url" value="${escapeHtml(webhookUrl)}" readonly style="flex:1" />
          <button class="btn btn-secondary" id="copy-conn-url-btn">Copy</button>
        </div>
        <span class="hint">
          Finish setup on IndiaMART's side: log in at seller.indiamart.com → Lead Manager → the ⋮ menu → Push API (under Import/Export Leads) → choose your CRM platform, or "Other" if it's not listed → paste this URL → confirm the OTP sent to your account's registered mobile number.
        </span>
      </div>
      <div class="flex gap-3">
        <button class="btn btn-secondary" id="regenerate-btn">Regenerate webhook URL</button>
        <button class="btn btn-secondary" id="disconnect-btn">Disconnect</button>
      </div>
    </div>`;

  cardEl.querySelector("#copy-conn-url-btn").addEventListener("click", (e) => copyToClipboard(webhookUrl, e.currentTarget));

  cardEl.querySelector("#regenerate-btn").addEventListener("click", async (e) => {
    const ok = await confirmDialog({
      title: "Regenerate webhook URL?",
      message: "This immediately invalidates the current URL — IndiaMART will no longer be able to deliver leads until you update the Push API setting on your IndiaMART dashboard with the new URL. Existing field mappings are kept.",
      confirmLabel: "Regenerate",
      danger: true,
    });
    if (!ok) return;
    await runConnect(e.currentTarget, onChange);
  });

  cardEl.querySelector("#disconnect-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Disconnect IndiaMART?",
      message: "New leads will stop being imported until you reconnect and update the URL on IndiaMART's dashboard again. Existing leads and field mappings are kept.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    try {
      await indiamartApi.disconnect();
      toastSuccess("IndiaMART webhook disconnected.");
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
    ({ events } = await indiamartApi.events(50));
  } catch (err) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load recent events", desc: err.message })}</div>`;
    return;
  }

  if (!events.length) {
    cardEl.innerHTML = `<div class="card-body">${emptyState({
      icon: "⇪",
      title: "No IndiaMART events yet",
      desc: "When IndiaMART delivers an enquiry, it will show up here — whether it was successfully turned into a lead or not.",
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
  const content = mountShell({ activeKey: "indiamart-integration", title: "IndiaMART Leads" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">IndiaMART Leads</h2>
        <p class="page-subtitle">Connect IndiaMART's Push API to import buyer enquiries automatically. Not a full seller-dashboard replacement — just enough to get leads into the CRM.</p>
      </div>
    </div>
    <div class="card mb-4" id="connection-card"></div>
    <div class="card mb-4" id="mapping-card"></div>
    <div class="page-header">
      <div>
        <h3 class="page-title" style="font-size:1.1rem">Recent events</h3>
        <p class="page-subtitle">Every enquiry IndiaMART has delivered, whether it became a lead or not.</p>
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
  const mappingCard = document.getElementById("mapping-card");
  const eventsCard = document.getElementById("events-card");

  const refresh = async () => {
    const connection = await renderConnectionCard(connectionCard, refresh);
    if (connection?.connected) {
      await renderMappings(mappingCard);
    } else {
      mappingCard.innerHTML = `<div class="card-body">${emptyState({
        icon: "▤",
        title: "Connect IndiaMART first",
        desc: "Field mapping becomes available once an IndiaMART webhook is connected above.",
      })}</div>`;
    }
  };

  await refresh();
  await renderEventsCard(eventsCard);
}

main();
