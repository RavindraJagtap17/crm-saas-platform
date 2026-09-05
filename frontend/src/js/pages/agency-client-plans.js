import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { clientPlansApi } from "../api/resources.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatMoney } from "../components/ui.js";

const BILLING_CYCLE_LABEL = { monthly: "Monthly", yearly: "Yearly" };

async function refresh(listEl) {
  listEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let plans;
  try {
    ({ plans } = await clientPlansApi.list());
  } catch (err) {
    listEl.innerHTML = `<div class="card">${emptyState({ icon: "⚠", title: "Couldn't load plans", desc: err.message })}</div>`;
    return;
  }

  if (!plans.length) {
    listEl.innerHTML = `<div class="card">${emptyState({
      icon: "$",
      title: "No Client plans yet",
      desc: "Create a monthly or yearly plan for your clients to subscribe to — set the price and how many active employees it allows.",
    })}</div>`;
    return;
  }

  listEl.innerHTML = `
    <div class="card">
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Price</th><th>Billing cycle</th><th>Employee limit</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${plans
              .map(
                (p) => `
              <tr>
                <td data-label="Name" class="table-cell-primary">${escapeHtml(p.name)}</td>
                <td data-label="Price">${formatMoney(p.price, p.currency)}</td>
                <td data-label="Billing cycle"><span class="badge badge-brand">${BILLING_CYCLE_LABEL[p.billingCycle] || p.billingCycle}</span></td>
                <td data-label="Employee limit" class="num">${p.maxActiveEmployees}</td>
                <td data-label="Status">${p.isActive ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
                <td data-label="" class="flex gap-2">
                  <button class="btn btn-secondary btn-sm" data-edit="${p.id}">Edit</button>
                  ${p.isActive ? `<button class="btn btn-ghost btn-sm" data-deactivate="${p.id}">Deactivate</button>` : ""}
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  listEl.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openForm(listEl, plans.find((p) => String(p.id) === btn.dataset.edit)))
  );
  listEl.querySelectorAll("[data-deactivate]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const plan = plans.find((p) => String(p.id) === btn.dataset.deactivate);
      const ok = await confirmDialog({
        title: `Deactivate "${plan.name}"?`,
        message: "Clients already on this plan are unaffected — it just won't be selectable for new subscriptions, and can't be renewed onto once its current period ends.",
        confirmLabel: "Deactivate",
        danger: true,
      });
      if (!ok) return;
      try {
        await clientPlansApi.deactivate(plan.id);
        toastSuccess("Plan deactivated.");
        refresh(listEl);
      } catch (err) {
        toastError(err.message);
      }
    })
  );
}

function openForm(listEl, plan) {
  const isEdit = !!plan;
  const { close } = openModal({
    title: isEdit ? "Edit Client plan" : "New Client plan",
    bodyHtml: `
      <form id="cp-form" novalidate>
        <div class="field">
          <label class="label" for="cp-name">Plan name</label>
          <input class="input" id="cp-name" value="${escapeHtml(plan?.name || "")}" placeholder="e.g. Growth" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="cp-price">Price <span class="hint">(in your currency's smallest unit, e.g. paise)</span></label>
            <input class="input" type="number" min="1" id="cp-price" value="${plan?.price ?? ""}" placeholder="499900" />
          </div>
          <div class="field">
            <label class="label" for="cp-currency">Currency</label>
            <input class="input" id="cp-currency" value="${escapeHtml(plan?.currency || "INR")}" maxlength="3" placeholder="INR" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="cp-cycle">Billing cycle</label>
            <select class="select" id="cp-cycle">
              <option value="monthly" ${plan?.billingCycle === "monthly" ? "selected" : ""}>Monthly</option>
              <option value="yearly" ${plan?.billingCycle === "yearly" ? "selected" : ""}>Yearly</option>
            </select>
          </div>
          <div class="field">
            <label class="label" for="cp-limit">Maximum active employees</label>
            <input class="input" type="number" min="0" id="cp-limit" value="${plan?.maxActiveEmployees ?? ""}" placeholder="10" />
          </div>
        </div>
        <div class="field-error" id="cp-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="cp-submit">${isEdit ? "Save changes" : "Create plan"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#cp-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#cp-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);

        const body = {
          name: modalEl.querySelector("#cp-name").value.trim(),
          price: Number(modalEl.querySelector("#cp-price").value),
          currency: modalEl.querySelector("#cp-currency").value.trim().toUpperCase() || "INR",
          billingCycle: modalEl.querySelector("#cp-cycle").value,
          maxActiveEmployees: Number(modalEl.querySelector("#cp-limit").value),
        };

        try {
          if (isEdit) {
            await clientPlansApi.update(plan.id, body);
          } else {
            await clientPlansApi.create(body);
          }
          closeFn();
          toastSuccess(isEdit ? "Plan updated." : "Plan created.");
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

async function main() {
  const user = await requireRole("agency_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "client-plans", title: "Client Plans" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Client Plans</h2>
        <p class="page-subtitle">The plans your clients can subscribe to — price, billing cycle, and how many active employees each allows.</p>
      </div>
      <button class="btn btn-primary" id="new-plan-btn">+ New Plan</button>
    </div>
    <div id="list"></div>
  `;

  document.getElementById("new-plan-btn").addEventListener("click", () => openForm(document.getElementById("list")));
  await refresh(document.getElementById("list"));
}

main();
