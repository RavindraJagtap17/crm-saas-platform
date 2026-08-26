import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { confirmDialog, openModal } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, formatDate, formatDateTime, formatMoney, accountStatusBadge, roleLabel, setButtonLoading, emptyState } from "../components/ui.js";

const SUBSCRIPTION_STATUS_BADGE = {
  created: "badge-neutral",
  authenticated: "badge-neutral",
  active: "badge-success",
  pending: "badge-warning",
  halted: "badge-danger",
  paused: "badge-warning",
  cancelled: "badge-neutral",
  completed: "badge-neutral",
  expired: "badge-neutral",
};

const tenantId = new URLSearchParams(window.location.search).get("id");

const STATUS_ACTIONS = {
  pending_payment: [{ to: "active", label: "Activate", danger: false }],
  active: [{ to: "suspended", label: "Suspend", danger: true }],
  suspended: [
    { to: "active", label: "Reactivate", danger: false },
    { to: "canceled", label: "Cancel", danger: true },
  ],
  canceled: [{ to: "active", label: "Reactivate", danger: false }],
};

function openChangePlanModal(currentPlanId, plans, onChanged) {
  const selectable = plans.filter((p) => p.is_active && p.id !== currentPlanId);
  openModal({
    title: "Change this tenant's plan",
    bodyHtml: `
      <form id="scp-form" novalidate>
        <div class="field">
          <label class="label" for="scp-plan">New plan</label>
          <select class="select" id="scp-plan">
            ${selectable.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} — ${formatMoney(p.price, p.currency)}/${escapeHtml(p.billing_cycle)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label class="label">When should this take effect?</label>
          <div class="flex-col gap-2">
            <label class="text-sm flex items-center gap-2"><input type="radio" name="scp-timing" value="now" checked /> Immediately</label>
            <label class="text-sm flex items-center gap-2"><input type="radio" name="scp-timing" value="cycle_end" /> At the end of the current billing cycle</label>
          </div>
        </div>
        <div class="field-error" id="scp-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="scp-submit">Request change</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#scp-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#scp-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const planId = Number(modalEl.querySelector("#scp-plan").value);
        const timing = modalEl.querySelector('input[name="scp-timing"]:checked').value;
        try {
          const result = await superAdminApi.changeTenantPlan(tenantId, planId, timing);
          closeFn();
          toastSuccess(result.message);
          onChanged();
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

function subscriptionCardHtml(subscription, plan) {
  if (!subscription) {
    return `<p class="text-sm mb-4">This tenant has no subscription yet — it hasn't completed self-service signup/checkout.
      The controls below are a manual override of the account status Razorpay would otherwise gate (§H/§K).</p>
      <div class="flex gap-2" id="status-actions"></div>`;
  }
  return `
    <div class="field-row mb-4">
      <div><span class="label">Plan</span><p>${plan ? escapeHtml(plan.name) : "—"}</p></div>
      <div><span class="label">Status</span><p><span class="badge ${SUBSCRIPTION_STATUS_BADGE[subscription.status] || "badge-neutral"}">${escapeHtml(subscription.status)}</span></p></div>
      <div><span class="label">Period ends</span><p>${subscription.currentPeriodEnd ? formatDateTime(subscription.currentPeriodEnd) : "—"}</p></div>
    </div>
    <div class="flex gap-2 mb-2" id="subscription-actions"></div>
    <div class="flex gap-2" id="status-actions"></div>
  `;
}

async function render(content) {
  let data, billing, plans;
  try {
    [data, billing, plans] = await Promise.all([
      superAdminApi.getTenant(tenantId),
      superAdminApi.getTenantSubscription(tenantId),
      superAdminApi.listPlans().then((r) => r.plans),
    ]);
  } catch (err) {
    content.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load this tenant", desc: err.message });
    return;
  }
  const { tenant, employeeSeatsUsed, users } = data;
  const { subscription, plan } = billing;

  content.innerHTML = `
    <a href="./index.html" class="text-sm">← All tenants</a>
    <div class="page-header mt-2">
      <div>
        <h2 class="page-title">${escapeHtml(tenant.name)}</h2>
        <p class="page-subtitle">${escapeHtml(tenant.slug)}</p>
      </div>
      ${accountStatusBadge(tenant.status)}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)">
      <div class="card">
        <div class="card-header"><h3 class="card-title">Employee limit</h3></div>
        <div class="card-body">
          <p class="text-sm mb-4">${employeeSeatsUsed} of <strong class="num">${tenant.employeeLimit}</strong> employee seats used.</p>
          <div class="field-row" style="align-items:end">
            <div class="field" style="margin-bottom:0">
              <label class="label" for="limit-input">New limit</label>
              <input class="input" type="number" min="0" id="limit-input" value="${tenant.employeeLimit}" />
            </div>
            <button class="btn btn-secondary" id="limit-save">Update limit</button>
          </div>
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
      <div class="card-header"><h3 class="card-title">Team (${users.length})</h3></div>
      <div class="table-wrap" style="border:none;border-radius:0">
        ${
          users.length
            ? `<table class="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
                <tbody>
                  ${users
                    .map(
                      (u) => `<tr>
                        <td data-label="Name" class="table-cell-primary">${escapeHtml(u.name)}</td>
                        <td data-label="Email" class="table-cell-muted">${escapeHtml(u.email)}</td>
                        <td data-label="Role">${roleLabel(u.role)}</td>
                        <td data-label="Status">${accountStatusBadge(u.status)}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>`
            : `<div class="card-body">${emptyState({ title: "No team members yet" })}</div>`
        }
      </div>
    </div>
  `;

  document.getElementById("limit-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const value = Number(document.getElementById("limit-input").value);
    if (!Number.isInteger(value) || value < 0) return toastError("Enter a valid non-negative number.");
    setButtonLoading(btn, true);
    try {
      await superAdminApi.updateEmployeeLimit(tenantId, value);
      toastSuccess("Employee limit updated.");
      render(content);
    } catch (err) {
      toastError(err.message);
    } finally {
      setButtonLoading(btn, false);
    }
  });

  if (!subscription) {
    // No subscription yet — the only lever available is the raw tenant
    // status (unchanged from before Step 9; kept for exactly this case).
    document.getElementById("status-actions").innerHTML = (STATUS_ACTIONS[tenant.status] || [])
      .map((a) => `<button class="btn ${a.danger ? "btn-danger" : "btn-primary"}" data-to="${a.to}">${a.label}</button>`)
      .join("");
    document.querySelectorAll("#status-actions [data-to]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const to = btn.dataset.to;
        const ok = await confirmDialog({
          title: `${btn.textContent} this tenant?`,
          message: `This changes ${tenant.name}'s status to "${to}", which affects whether their team can use the workspace.`,
          confirmLabel: btn.textContent,
          danger: btn.classList.contains("btn-danger"),
        });
        if (!ok) return;
        try {
          await superAdminApi.updateStatus(tenantId, to);
          toastSuccess(`Tenant status set to ${to}.`);
          render(content);
        } catch (err) {
          toastError(err.message);
        }
      })
    );
    return;
  }

  // §K: a real subscription exists — every action here goes through
  // billingService (via these super-admin routes), which calls Razorpay's
  // real pause/resume/cancel/update-plan APIs. Never blocked by the
  // tenant's own status (Super Admin is exempt from requireActiveTenant).
  const actionsEl = document.getElementById("subscription-actions");
  const runAction = async (fn, confirmOpts) => {
    if (confirmOpts) {
      const ok = await confirmDialog(confirmOpts);
      if (!ok) return;
    }
    try {
      await fn();
      toastSuccess("Done.");
      render(content);
    } catch (err) {
      toastError(err.message);
    }
  };

  if (subscription.status === "active") {
    actionsEl.innerHTML = `<button class="btn btn-secondary" id="sa-change">Change plan</button><button class="btn btn-danger" id="sa-suspend">Suspend</button>`;
    document.getElementById("sa-change").addEventListener("click", () => openChangePlanModal(subscription.planId, plans, () => render(content)));
    document.getElementById("sa-suspend").addEventListener("click", () =>
      runAction(() => superAdminApi.suspendTenantSubscription(tenantId), {
        title: "Suspend this tenant?",
        message: `${tenant.name}'s Razorpay subscription will be paused (no further charges) and their workspace access blocked until resumed.`,
        confirmLabel: "Suspend",
        danger: true,
      })
    );
  } else if (["paused", "halted"].includes(subscription.status)) {
    actionsEl.innerHTML = `<button class="btn btn-primary" id="sa-resume">Resume</button><button class="btn btn-danger" id="sa-cancel">Cancel</button>`;
    document.getElementById("sa-resume").addEventListener("click", () => runAction(() => superAdminApi.resumeTenantSubscription(tenantId)));
    document.getElementById("sa-cancel").addEventListener("click", () =>
      runAction(() => superAdminApi.cancelTenantSubscription(tenantId), {
        title: "Cancel this tenant's subscription?",
        message: `This permanently ends ${tenant.name}'s Razorpay subscription. A new subscription would be required to reactivate.`,
        confirmLabel: "Cancel subscription",
        danger: true,
      })
    );
  }
  // created/authenticated/pending/cancelled/completed/expired: no override
  // action offered here — either still awaiting the tenant's own payment,
  // or already permanently ended.
}

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "overview", title: "Tenant" });
  if (!tenantId) {
    content.innerHTML = emptyState({ title: "No tenant specified" });
    return;
  }
  await render(content);
}

main();
