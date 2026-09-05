import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { confirmDialog, openModal } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, formatDate, formatDateTime, formatMoney, accountStatusBadge, setButtonLoading, emptyState } from "../components/ui.js";

// New business model — single-plan self-service Agency subscription
// (agency_subscription_plan/agency_subscriptions). Status labels mirror
// admin-billing.js's own Client-subscription vocabulary exactly, since
// both use the same 5-value status enum (pending/active/grace_period/
// cancelled/expired).
const SUBSCRIPTION_STATUS_LABEL = {
  pending: "Awaiting payment",
  active: "Active",
  grace_period: "Grace period",
  cancelled: "Cancelled",
  expired: "Expired",
};
const SUBSCRIPTION_STATUS_BADGE = {
  pending: "badge-warning",
  active: "badge-success",
  grace_period: "badge-warning",
  cancelled: "badge-neutral",
  expired: "badge-neutral",
};

const tenantId = new URLSearchParams(window.location.search).get("id");

// Manual escape-hatch for an agency with NO subscription in either billing
// system yet (e.g. before they've completed signup+payment) — flips
// tenants.status directly via superAdminService.updateStatus, independent
// of any subscription model. Not part of the Agency billing migration:
// left exactly as it was.
const STATUS_ACTIONS = {
  pending_payment: [{ to: "active", label: "Activate", danger: false }],
  active: [{ to: "suspended", label: "Suspend", danger: true }],
  suspended: [
    { to: "active", label: "Reactivate", danger: false },
    { to: "canceled", label: "Cancel", danger: true },
  ],
  canceled: [{ to: "active", label: "Reactivate", danger: false }],
};

function openInviteAgencyAdminModal(onInvited) {
  openModal({
    title: "Invite Agency Admin",
    bodyHtml: `
      <form id="ia-form" novalidate>
        <div class="field">
          <label class="label" for="ia-name">Name</label>
          <input class="input" id="ia-name" placeholder="Jane Doe" />
        </div>
        <div class="field">
          <label class="label" for="ia-email">Email</label>
          <input class="input" type="email" id="ia-email" placeholder="jane@agency.com" />
          <span class="hint">They'll sign in with this exact Google account.</span>
        </div>
        <div class="field-error" id="ia-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="ia-submit">Send invite</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#ia-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#ia-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        try {
          await superAdminApi.inviteAgencyAdmin(tenantId, {
            name: modalEl.querySelector("#ia-name").value.trim(),
            email: modalEl.querySelector("#ia-email").value.trim(),
            role: "agency_admin",
          });
          closeFn();
          toastSuccess("Agency Admin invited.");
          onInvited();
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

/**
 * New business model — single-plan self-service Agency subscription.
 * Read-only: the finalized model gives Super Admin no manual suspend/
 * resume/change-plan control over it (unlike the old §K catalog override
 * this replaces) — recovery is Agency-Admin self-service (their own
 * Billing page), and expiry is webhook/grace-period driven. The one
 * escape hatch that remains is STATUS_ACTIONS below, shown only when no
 * subscription exists at all in either system.
 */
function subscriptionCardHtml(subscription, plan) {
  if (!subscription) {
    return `<p class="text-sm mb-4">This agency has no subscription yet.
      The controls below are a manual override of the account status Razorpay would otherwise gate.</p>
      <div class="flex gap-2" id="status-actions"></div>`;
  }
  return `
    <div class="field-row mb-4">
      <div><span class="label">Price</span><p>${plan ? `${formatMoney(plan.price, plan.currency)} / ${escapeHtml(plan.billingCycle || "yearly")}` : "—"}</p></div>
      <div><span class="label">Status</span><p><span class="badge ${SUBSCRIPTION_STATUS_BADGE[subscription.status] || "badge-neutral"}">${escapeHtml(SUBSCRIPTION_STATUS_LABEL[subscription.status] || subscription.status)}</span></p></div>
      <div><span class="label">Current period ends</span><p>${subscription.currentPeriodEnd ? formatDateTime(subscription.currentPeriodEnd) : "—"}</p></div>
    </div>
    ${
      subscription.status === "grace_period"
        ? `<div class="alert alert-warning mb-4"><span>⚠</span><span>In grace period${subscription.gracePeriodEndsAt ? ` until ${escapeHtml(formatDateTime(subscription.gracePeriodEndsAt))}` : ""} — the agency stays usable until then.</span></div>`
        : ""
    }
    ${
      !subscription.autoRenew && ["pending", "active", "grace_period"].includes(subscription.status)
        ? `<div class="alert alert-warning mb-4"><span>ⓘ</span><span>Auto-renewal is off — access continues until the current period ends, then this subscription ends.</span></div>`
        : ""
    }
    <div class="flex gap-2" id="status-actions"></div>
  `;
}

async function render(content) {
  let data, billing;
  try {
    [data, billing] = await Promise.all([superAdminApi.getTenant(tenantId), superAdminApi.getTenantAgencySubscription(tenantId)]);
  } catch (err) {
    content.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load this agency", desc: err.message });
    return;
  }
  const { tenant, clientCount, clients, users } = data;
  const { subscription, plan } = billing;

  content.innerHTML = `
    <a href="./index.html" class="text-sm">← All agencies</a>
    <div class="page-header mt-2">
      <div>
        <h2 class="page-title">${escapeHtml(tenant.name)}</h2>
        <p class="page-subtitle">${escapeHtml(tenant.slug)}</p>
      </div>
      ${accountStatusBadge(tenant.status)}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)">
      <div class="card">
        <div class="card-header"><h3 class="card-title">Agency Admins (${users.length})</h3><button class="btn btn-secondary btn-sm" id="invite-admin-btn">+ Invite Agency Admin</button></div>
        <div class="table-wrap" style="border:none;border-radius:0">
          ${
            users.length
              ? `<table class="data-table">
                  <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                  <tbody>
                    ${users
                      .map(
                        (u) => `<tr>
                          <td data-label="Name" class="table-cell-primary">${escapeHtml(u.name)}</td>
                          <td data-label="Email" class="table-cell-muted">${escapeHtml(u.email)}</td>
                          <td data-label="Status">${accountStatusBadge(u.status)}</td>
                        </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
              : `<div class="card-body">${emptyState({ title: "No Agency Admin invited yet" })}</div>`
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="card-title">Subscription</h3></div>
        <div class="card-body">
          ${subscriptionCardHtml(subscription, plan)}
        </div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-header"><h3 class="card-title">Clients (${clientCount})</h3></div>
      <div class="table-wrap" style="border:none;border-radius:0">
        ${
          clients.length
            ? `<table class="data-table">
                <thead><tr><th>Name</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>
                  ${clients
                    .map(
                      (c) => `<tr>
                        <td data-label="Name" class="table-cell-primary">${escapeHtml(c.name)}</td>
                        <td data-label="Status">${c.status === "active" ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
                        <td data-label="Created" class="text-secondary text-sm">${formatDate(c.created_at)}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>`
            : `<div class="card-body">${emptyState({ title: "No clients yet", desc: "The Agency Admin adds clients from their own Clients page." })}</div>`
        }
      </div>
    </div>
  `;

  document.getElementById("invite-admin-btn").addEventListener("click", () => openInviteAgencyAdminModal(() => render(content)));

  if (!subscription) {
    document.getElementById("status-actions").innerHTML = (STATUS_ACTIONS[tenant.status] || [])
      .map((a) => `<button class="btn ${a.danger ? "btn-danger" : "btn-primary"}" data-to="${a.to}">${a.label}</button>`)
      .join("");
    document.querySelectorAll("#status-actions [data-to]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const to = btn.dataset.to;
        const ok = await confirmDialog({
          title: `${btn.textContent} this agency?`,
          message: `This changes ${tenant.name}'s status to "${to}", which affects whether their clients can use the workspace.`,
          confirmLabel: btn.textContent,
          danger: btn.classList.contains("btn-danger"),
        });
        if (!ok) return;
        try {
          await superAdminApi.updateStatus(tenantId, to);
          toastSuccess(`Agency status set to ${to}.`);
          render(content);
        } catch (err) {
          toastError(err.message);
        }
      })
    );
    return;
  }

  // A subscription exists — no Super Admin actions in the finalized model
  // (see subscriptionCardHtml's own comment); the card is read-only.
}

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "overview", title: "Agency" });
  if (!content) return;
  if (!tenantId) {
    content.innerHTML = emptyState({ title: "No agency specified" });
    return;
  }
  await render(content);
}

main();
