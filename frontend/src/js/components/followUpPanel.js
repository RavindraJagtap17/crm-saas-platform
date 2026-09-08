import { followUpsApi, leadsApi } from "../api/resources.js";
import { openModal, confirmDialog } from "./modal.js";
import { toastSuccess, toastError } from "./toast.js";
import { escapeHtml, formatDateTime, setButtonLoading, emptyState, followUpStatusBadge } from "./ui.js";
import { refreshFollowUpIndicator } from "./shell.js";

// Splits a stored ISO instant back into the <input type="date">/
// <input type="time"> values a form needs, in the VIEWER's own local
// timezone (§8: render local, store UTC — Date's local getters do exactly
// that conversion; no second timezone model is introduced here).
function toDateTimeInputs(isoValue) {
  const d = new Date(isoValue);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// Combines the two local-timezone picker fields into one absolute instant
// — `new Date(y, m, d, h, min)` (the multi-arg form, NOT a string) is
// interpreted in the BROWSER's own local timezone by spec, and
// .toISOString() below converts that to the UTC instant the backend
// stores (§8). Returns null if either field is empty/unparseable.
function combineDateTimeToIso(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [y, mo, da] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const d = new Date(y, mo - 1, da, h, mi, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function assignedToFieldHtml({ currentUser, assignableUsers, selectedId }) {
  // A Client Employee may only ever schedule/reassign to themselves
  // (enforced server-side too — see leadFollowUpService.requireAssignable)
  // — showing a locked value instead of a dropdown makes that plain
  // rather than presenting a choice the server will just reject.
  if (!assignableUsers) {
    return `
      <div class="field">
        <label class="label">Assigned To</label>
        <input class="input" value="${escapeHtml(currentUser.name)} (you)" disabled />
      </div>`;
  }
  return `
    <div class="field">
      <label class="label" for="fu-assigned">Assigned To</label>
      <select class="select" id="fu-assigned">
        ${assignableUsers
          .map((u) => `<option value="${u.id}" ${String(u.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(u.name)} (${u.role.replace("client_", "")})</option>`)
          .join("")}
      </select>
    </div>`;
}

function scheduleFormHtml({ currentUser, assignableUsers, defaults }) {
  const { date, time } = defaults?.scheduledAt ? toDateTimeInputs(defaults.scheduledAt) : { date: "", time: "" };
  return `
    <form id="fu-form" novalidate>
      <div class="field-row">
        <div class="field">
          <label class="label" for="fu-date">Date</label>
          <input class="input" type="date" id="fu-date" value="${date}" />
        </div>
        <div class="field">
          <label class="label" for="fu-time">Time</label>
          <input class="input" type="time" id="fu-time" value="${time}" />
        </div>
      </div>
      ${assignedToFieldHtml({ currentUser, assignableUsers, selectedId: defaults?.assignedTo ?? currentUser.id })}
      <div class="field" style="margin-bottom:0">
        <label class="label" for="fu-notes">Notes <span class="optional">(optional)</span></label>
        <textarea class="textarea" id="fu-notes">${escapeHtml(defaults?.notes || "")}</textarea>
      </div>
      <div class="field-error" id="fu-error" hidden></div>
    </form>`;
}

// Exported so the Follow-ups list page (admin-follow-ups.js/
// employee-follow-ups.js) can reuse the exact same reschedule modal —
// date/time-picker combining, the employee-locked-to-self assignee field —
// instead of re-implementing it for a second surface.
export function openScheduleModal({ title, currentUser, assignableUsers, defaults, onSubmit }) {
  openModal({
    title,
    bodyHtml: scheduleFormHtml({ currentUser, assignableUsers, defaults }),
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="fu-submit">Save</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#fu-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#fu-error");
        errEl.hidden = true;

        const scheduledAt = combineDateTimeToIso(modalEl.querySelector("#fu-date").value, modalEl.querySelector("#fu-time").value);
        if (!scheduledAt) {
          errEl.hidden = false;
          errEl.textContent = "Date and time are both required.";
          return;
        }
        const assignedSelect = modalEl.querySelector("#fu-assigned");
        const assignedTo = assignedSelect ? Number(assignedSelect.value) : currentUser.id;
        const notes = modalEl.querySelector("#fu-notes").value.trim() || undefined;

        setButtonLoading(btn, true);
        try {
          await onSubmit({ scheduledAt, assignedTo, notes });
          closeFn();
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

function followUpItemHtml(fu) {
  return `
    <div class="card" style="padding:var(--space-3) var(--space-4)" data-follow-up="${fu.id}">
      <div class="flex justify-between items-start gap-2">
        <div>
          <div class="font-semibold text-sm">${formatDateTime(fu.scheduledAt)}</div>
          <div class="text-xs text-tertiary mt-1">Assigned to ${escapeHtml(fu.assignedToName || "—")}</div>
          ${fu.notes ? `<p class="text-sm mt-2" style="color:var(--text-primary)">${escapeHtml(fu.notes)}</p>` : ""}
        </div>
        ${followUpStatusBadge(fu.status, fu.isOverdue)}
      </div>
      ${
        fu.status === "pending"
          ? `<div class="flex gap-2 mt-3">
              <button class="btn btn-secondary btn-sm" data-reschedule="${fu.id}">Reschedule</button>
              <button class="btn btn-secondary btn-sm" data-complete="${fu.id}">Complete</button>
              <button class="btn btn-ghost btn-sm" data-cancel-fu="${fu.id}">Cancel</button>
            </div>`
          : ""
      }
    </div>`;
}

/**
 * Renders the Lead detail page's "Follow-ups" card (§5): the next pending
 * follow-up highlighted, full history below, and the Schedule/Reschedule/
 * Complete/Cancel actions. `assignableUsers` is only passed for a Client
 * Admin (the full active client_admin/client_employee roster, same list
 * "Reassign lead" already uses) — omit it for a Client Employee, whose
 * every follow-up here is implicitly their own (server-enforced too, via
 * GET /api/follow-ups?leadId= being scoped to assigned_to = self for that
 * role — see leadFollowUpService.scopeFor).
 */
export async function renderFollowUpPanel(container, { leadId, currentUser, assignableUsers }) {
  container.innerHTML = `<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row" style="width:70%"></div>`;

  let items = [];

  function findById(id) {
    return items.find((f) => String(f.id) === String(id));
  }

  function renderScheduleButton() {
    if (container.querySelector("[data-schedule-fu]")) return;
    const btn = document.createElement("button");
    btn.className = "btn btn-primary btn-sm mb-3";
    btn.dataset.scheduleFu = "1";
    btn.textContent = "+ Schedule Follow-up";
    btn.addEventListener("click", () => {
      openScheduleModal({
        title: "Schedule follow-up",
        currentUser,
        assignableUsers,
        onSubmit: async (body) => {
          await leadsApi.createFollowUp(leadId, body);
          toastSuccess("Follow-up scheduled.");
          await refresh();
          refreshFollowUpIndicator();
        },
      });
    });
    container.prepend(btn);
  }

  function wireActions() {
    container.querySelectorAll("[data-reschedule]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.reschedule;
        openScheduleModal({
          title: "Reschedule follow-up",
          currentUser,
          assignableUsers,
          defaults: findById(id),
          onSubmit: async (body) => {
            await followUpsApi.update(id, body);
            toastSuccess("Follow-up rescheduled.");
            await refresh();
            refreshFollowUpIndicator();
          },
        });
      })
    );
    container.querySelectorAll("[data-complete]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Mark this follow-up complete?",
          message: "This records it as done and logs it on the lead's activity timeline.",
          confirmLabel: "Complete",
        });
        if (!ok) return;
        try {
          await followUpsApi.complete(btn.dataset.complete);
          toastSuccess("Follow-up completed.");
          await refresh();
          refreshFollowUpIndicator();
        } catch (err) {
          toastError(err.message);
        }
      })
    );
    container.querySelectorAll("[data-cancel-fu]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog({ title: "Cancel this follow-up?", message: "This cannot be undone.", confirmLabel: "Cancel follow-up", danger: true });
        if (!ok) return;
        try {
          await followUpsApi.cancel(btn.dataset.cancelFu);
          toastSuccess("Follow-up cancelled.");
          await refresh();
          refreshFollowUpIndicator();
        } catch (err) {
          toastError(err.message);
        }
      })
    );
  }

  async function refresh() {
    try {
      items = (await followUpsApi.list({ leadId })).items;
    } catch (err) {
      container.innerHTML = `<p class="text-secondary">${escapeHtml(err.message)}</p>`;
      return;
    }

    if (!items.length) {
      container.innerHTML = emptyState({ icon: "⏰", title: "No follow-ups scheduled", desc: "Schedule one to keep this lead moving." });
      renderScheduleButton();
      return;
    }

    const pending = items.filter((f) => f.status === "pending").sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    const next = pending[0] || null;
    const history = items.filter((f) => f.id !== next?.id);

    container.innerHTML = `
      ${next ? `<div class="mb-3"><span class="label">Next follow-up</span><div class="mt-2">${followUpItemHtml(next)}</div></div>` : ""}
      ${
        history.length
          ? `<div><span class="label">${next ? "History" : "Follow-ups"}</span><div class="flex-col gap-2 mt-2">${history.map((f) => followUpItemHtml(f)).join("")}</div></div>`
          : ""
      }
    `;
    renderScheduleButton();
    wireActions();
  }

  await refresh();
}
