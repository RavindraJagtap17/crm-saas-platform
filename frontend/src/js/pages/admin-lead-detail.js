import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { leadsApi, leadStatusesApi, leadSourcesApi, productsApi, customFieldsApi, usersApi } from "../api/resources.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, formatDateTime, relativeTime, avatarHtml, emptyState, setButtonLoading, duplicateBadge } from "../components/ui.js";
import { buildLeadFormHtml, readLeadFormValues, clearLeadFormErrors, showLeadFormError } from "../components/leadForm.js";

const leadId = new URLSearchParams(window.location.search).get("id");
let ref = null; // { statuses, sources, products, customFields, users }
let currentLead = null;

function byId(list, id) {
  return list.find((x) => String(x.id) === String(id));
}

function activityIcon(type) {
  return { call: "📞", note: "📝", assignment: "👤" }[type] || "•";
}

async function loadRefData() {
  const [statuses, sources, products, customFields, users] = await Promise.all([
    leadStatusesApi.list().then((r) => r.statuses),
    leadSourcesApi.list().then((r) => r.sources),
    productsApi.list(true).then((r) => r.products),
    customFieldsApi.list().then((r) => r.customFields),
    usersApi.list().then((r) => r.users).catch(() => []),
  ]);
  return { statuses, sources, products, customFields, users };
}

function renderShell(content) {
  content.innerHTML = `
    <a href="./leads.html" class="text-sm">← Back to leads</a>
    <div class="page-header mt-2">
      <div>
        <h2 class="page-title" id="lead-name">Loading…</h2>
        <p class="page-subtitle" id="lead-sub"></p>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-secondary" id="edit-lead-btn">Edit</button>
        <button class="btn btn-danger" id="delete-lead-btn">Delete</button>
      </div>
    </div>

    <div id="duplicate-banner"></div>

    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:var(--space-6)" id="lead-grid">
      <div class="flex-col gap-6">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Details</h3></div>
          <div class="card-body" id="lead-details"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Activity timeline</h3>
          </div>
          <div class="card-body">
            <form id="activity-form" class="flex-col gap-3 mb-4">
              <div class="field-row" style="align-items:end">
                <div class="field" style="margin-bottom:0">
                  <label class="label" for="act-type">Type</label>
                  <select class="select" id="act-type">
                    <option value="call">Call</option>
                    <option value="note">Note</option>
                  </select>
                </div>
                <div class="field" style="margin-bottom:0">
                  <label class="label" for="act-outcome">Outcome <span class="optional">(optional)</span></label>
                  <input class="input" id="act-outcome" placeholder="e.g. Interested, No answer" />
                </div>
              </div>
              <div class="field" style="margin-bottom:0">
                <label class="label" for="act-remarks">Remarks</label>
                <textarea class="textarea" id="act-remarks" placeholder="What happened on this call?"></textarea>
              </div>
              <div class="field-error" id="activity-error" hidden></div>
              <button class="btn btn-primary" style="align-self:flex-end" id="activity-submit" type="submit">Log activity</button>
            </form>
            <div class="divider"></div>
            <div id="activity-list"></div>
          </div>
        </div>
      </div>

      <div class="flex-col gap-6">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Pipeline</h3></div>
          <div class="card-body flex-col gap-4">
            <div class="field" style="margin-bottom:0">
              <label class="label" for="status-select">Status</label>
              <select class="select" id="status-select"></select>
            </div>
            <button class="btn btn-secondary btn-block" id="status-save">Update status</button>
            <div class="divider"></div>
            <div>
              <span class="label">Assigned to</span>
              <div class="flex items-center gap-2 mt-2" id="assigned-display"></div>
            </div>
            <button class="btn btn-secondary btn-block" id="assign-btn">Reassign</button>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title">Status history</h3></div>
          <div class="card-body" id="status-history"></div>
        </div>
      </div>
    </div>
  `;
}

function renderDetails(lead) {
  const source = byId(ref.sources, lead.sourceId);
  const product = byId(ref.products, lead.productId);
  const customEntries = Object.entries(lead.customFields || {});

  document.getElementById("lead-details").innerHTML = `
    <div class="field-row mb-4">
      <div><span class="label">Name</span><div class="mt-2">${escapeHtml(lead.name || "—")}</div></div>
      <div><span class="label">Phone</span><div class="mt-2">${escapeHtml(lead.phone || "—")}</div></div>
    </div>
    <div class="field-row mb-4">
      <div><span class="label">Email</span><div class="mt-2">${escapeHtml(lead.email || "—")}</div></div>
      <div><span class="label">Source</span><div class="mt-2">${escapeHtml(source?.name || "—")}</div></div>
    </div>
    <div class="field-row mb-4">
      <div><span class="label">Product</span><div class="mt-2">${escapeHtml(product?.name || "—")}</div></div>
      <div><span class="label">Created</span><div class="mt-2">${formatDateTime(lead.createdAt)}</div></div>
    </div>
    ${
      customEntries.length
        ? `<div class="divider"></div><span class="label">Custom fields</span>
           <div class="field-row mt-2">
             ${customEntries
               .map(([k, val]) => {
                 const def = ref.customFields.find((d) => d.field_key === k);
                 return `<div><span class="text-xs text-tertiary">${escapeHtml(def?.label || k)}</span><div>${escapeHtml(String(val))}</div></div>`;
               })
               .join("")}
           </div>`
        : ""
    }
  `;
}

function renderDuplicateBanner(lead) {
  const el = document.getElementById("duplicate-banner");
  if (!lead.isDuplicate) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="alert alert-warning mb-4">
      <span>⧉</span>
      <span>This lead shares a phone number with an earlier lead.
        <a href="./lead-detail.html?id=${lead.duplicateOfLeadId}">View the original lead (#${lead.duplicateOfLeadId})</a>.
      </span>
    </div>`;
}

function renderPipelinePanel(lead) {
  const statusSelect = document.getElementById("status-select");
  statusSelect.innerHTML =
    `<option value="">— No status —</option>` +
    ref.statuses.map((s) => `<option value="${s.id}" ${String(s.id) === String(lead.statusId) ? "selected" : ""}>${escapeHtml(s.name)}${s.is_final ? " (final)" : ""}</option>`).join("");

  const assignedUser = byId(ref.users, lead.assignedTo);
  document.getElementById("assigned-display").innerHTML = assignedUser
    ? `${avatarHtml(assignedUser.name, "avatar-sm")} <span>${escapeHtml(assignedUser.name)}</span>`
    : `<span class="text-tertiary">Unassigned</span>`;
}

async function renderActivities() {
  const listEl = document.getElementById("activity-list");
  listEl.innerHTML = `<div class="skeleton skeleton-row" style="width:70%"></div>`;
  try {
    const { activities } = await leadsApi.activities(leadId);
    if (!activities.length) {
      listEl.innerHTML = emptyState({ icon: "🕓", title: "No activity yet", desc: "Log a call or note above." });
      return;
    }
    listEl.innerHTML = `
      <ul class="flex-col gap-4">
        ${activities
          .slice()
          .reverse()
          .map(
            (a) => `
          <li class="flex gap-3">
            <span aria-hidden="true">${activityIcon(a.type)}</span>
            <div style="flex:1">
              <div class="flex justify-between">
                <span class="font-semibold text-sm">${escapeHtml(a.user_name || "System")}</span>
                <span class="text-xs text-tertiary" title="${formatDateTime(a.created_at)}">${relativeTime(a.created_at)}</span>
              </div>
              ${a.outcome ? `<div class="text-xs"><span class="badge badge-info">${escapeHtml(a.outcome)}</span></div>` : ""}
              ${a.remarks ? `<p class="text-sm mt-2" style="color:var(--text-primary)">${escapeHtml(a.remarks)}</p>` : ""}
            </div>
          </li>`
          )
          .join("")}
      </ul>`;
  } catch (err) {
    listEl.innerHTML = `<p class="text-secondary">${escapeHtml(err.message)}</p>`;
  }
}

async function renderStatusHistory() {
  const el = document.getElementById("status-history");
  try {
    // Status history isn't exposed as its own endpoint yet — activities
    // already gives us the timeline; this panel reads the lead's own
    // current/previous status instead of a dedicated history list.
    const statusName = byId(ref.statuses, currentLead.statusId)?.name;
    el.innerHTML = statusName
      ? `<p class="text-sm">Current: <strong>${escapeHtml(statusName)}</strong></p><p class="text-xs text-tertiary mt-2">Every change is recorded server-side (lead_status_history) for future reporting.</p>`
      : emptyState({ icon: "◔", title: "No status set yet" });
  } catch (err) {
    el.innerHTML = `<p class="text-secondary">${escapeHtml(err.message)}</p>`;
  }
}

async function reloadLead() {
  currentLead = (await leadsApi.get(leadId)).lead;
  document.getElementById("lead-name").textContent = currentLead.name || currentLead.phone || currentLead.email || `Lead #${currentLead.id}`;
  document.getElementById("lead-sub").innerHTML = duplicateBadge(currentLead.isDuplicate) || `Lead #${currentLead.id}`;
  renderDetails(currentLead);
  renderDuplicateBanner(currentLead);
  renderPipelinePanel(currentLead);
  renderStatusHistory();
  return currentLead;
}

function wireActions(content) {
  document.getElementById("status-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const value = document.getElementById("status-select").value;
    if (!value) return toastError("Choose a status first.");
    setButtonLoading(btn, true);
    try {
      await leadsApi.changeStatus(leadId, Number(value));
      await reloadLead();
      toastSuccess("Status updated.");
    } catch (err) {
      toastError(err.message);
    } finally {
      setButtonLoading(btn, false);
    }
  });

  document.getElementById("assign-btn").addEventListener("click", () => {
    const assignable = ref.users.filter((u) => u.status === "active");
    const { close } = openModal({
      title: "Reassign lead",
      bodyHtml: `
        <div class="field">
          <label class="label" for="assign-select">Employee</label>
          <select class="select" id="assign-select">
            <option value="">— Unassign —</option>
            ${assignable.map((u) => `<option value="${u.id}" ${String(u.id) === String(currentLead.assignedTo) ? "selected" : ""}>${escapeHtml(u.name)} (${u.role.replace("tenant_", "")})</option>`).join("")}
          </select>
        </div>`,
      footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="assign-confirm">Save</button>`,
      onMount: (modalEl, closeFn) => {
        modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
        modalEl.querySelector("#assign-confirm").addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          setButtonLoading(btn, true);
          const value = modalEl.querySelector("#assign-select").value;
          try {
            await leadsApi.assign(leadId, value ? Number(value) : null);
            closeFn();
            await reloadLead();
            toastSuccess("Assignment updated.");
          } catch (err) {
            toastError(err.message);
          } finally {
            setButtonLoading(btn, false);
          }
        });
      },
    });
    void close;
  });

  document.getElementById("edit-lead-btn").addEventListener("click", () => {
    const { close } = openModal({
      title: "Edit lead",
      bodyHtml: `<form id="edit-lead-form" novalidate>${buildLeadFormHtml({ sources: ref.sources, products: ref.products, customFieldDefs: ref.customFields, lead: currentLead })}</form>`,
      footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="edit-lead-submit">Save changes</button>`,
      onMount: (modalEl, closeFn) => {
        modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
        const form = modalEl.querySelector("#edit-lead-form");
        modalEl.querySelector("#edit-lead-submit").addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          clearLeadFormErrors(form);
          setButtonLoading(btn, true);
          try {
            const body = readLeadFormValues(form);
            await leadsApi.update(leadId, body);
            closeFn();
            await reloadLead();
            toastSuccess("Lead updated.");
          } catch (err) {
            showLeadFormError(form, err.message);
          } finally {
            setButtonLoading(btn, false);
          }
        });
      },
    });
    void close;
  });

  document.getElementById("delete-lead-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Delete this lead?",
      message: "This permanently removes the lead and its activity history. This cannot be undone.",
      confirmLabel: "Delete lead",
      danger: true,
    });
    if (!ok) return;
    try {
      await leadsApi.remove(leadId);
      toastSuccess("Lead deleted.");
      window.location.href = "./leads.html";
    } catch (err) {
      toastError(err.message);
    }
  });

  document.getElementById("activity-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("activity-error");
    errEl.hidden = true;
    const btn = document.getElementById("activity-submit");
    setButtonLoading(btn, true);
    try {
      await leadsApi.addActivity(leadId, {
        type: document.getElementById("act-type").value,
        outcome: document.getElementById("act-outcome").value.trim() || undefined,
        remarks: document.getElementById("act-remarks").value.trim() || undefined,
      });
      document.getElementById("activity-form").reset();
      await renderActivities();
      toastSuccess("Activity logged.");
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

async function main() {
  const user = await requireRole("tenant_admin");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "leads", title: "Lead" });

  if (!leadId) {
    content.innerHTML = emptyState({ title: "No lead specified" });
    return;
  }

  try {
    ref = await loadRefData();
    renderShell(content);
    await reloadLead();
    wireActions(content);
    await renderActivities();
  } catch (err) {
    content.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load this lead", desc: err.message });
  }
}

main();
