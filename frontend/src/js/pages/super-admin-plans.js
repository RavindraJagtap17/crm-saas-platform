import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading } from "../components/ui.js";

/**
 * New business model: exactly ONE Agency subscription plan (agency_
 * subscription_plan, migration 041) — Super Admin sets/updates its price
 * via GET/PUT /api/super-admin/agency-plan. This replaces the old Step 9
 * multi-plan "Plan Catalog" (subscription_plans/subscriptionPlanService),
 * which modeled several selectable Agency plans with a per-plan client
 * limit — neither concept exists in the finalized model ("exactly ONE
 * Agency subscription plan"; "NO Agency-level Client limit"). The old
 * catalog's backend routes/service/model are left untouched (still used
 * by any tenant on the old flow — see billingService.js) but nothing on
 * this page calls them any more.
 */
function planFormHtml(plan) {
  return `
    <form id="ap-form" novalidate>
      <div class="field-row">
        <div class="field">
          <label class="label" for="ap-price">Price</label>
          <input class="input" type="number" min="0" step="0.01" id="ap-price" value="${plan ? (plan.price / 100).toFixed(2) : ""}" placeholder="9999.00" />
          <span class="hint">Same amount as the Plan you've created for this in the Razorpay Dashboard.</span>
        </div>
        <div class="field">
          <label class="label" for="ap-currency">Currency</label>
          <input class="input" id="ap-currency" value="${escapeHtml(plan?.currency || "INR")}" maxlength="3" style="text-transform:uppercase" />
        </div>
      </div>
      <div class="field">
        <span class="label">Billing cycle</span>
        <p class="text-sm text-secondary">Yearly — fixed by the business model, not configurable here.</p>
      </div>
      <div class="field">
        <label class="label" for="ap-razorpay-id">Razorpay Plan ID <span class="optional">(technical, advanced)</span></label>
        <input class="input" id="ap-razorpay-id" value="${escapeHtml(plan?.razorpayPlanId || plan?.razorpay_plan_id || "")}" placeholder="plan_ABC123xyz" />
        <span class="hint">From the Razorpay Dashboard → Plans. Created there first — this app never creates or edits a Razorpay Plan itself. Required before Agency signup can accept payment.</span>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="ap-active" ${plan?.isActive ?? plan?.is_active ?? true ? "checked" : ""} />
        <label for="ap-active" class="text-sm">Active — agencies can sign up and subscribe to this plan</label>
      </div>
      <div class="field-error" id="ap-error" hidden></div>
    </form>`;
}

async function refresh(container) {
  container.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let plan;
  try {
    ({ plan } = await superAdminApi.getAgencyPlan());
  } catch (err) {
    container.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load the Agency plan", desc: err.message })}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="card" style="max-width:560px">
      ${
        !plan
          ? `<div class="card-body">${emptyState({
              icon: "$",
              title: "No Agency plan set up yet",
              desc: "Set a price to allow agencies to sign up and subscribe.",
            })}</div>`
          : ""
      }
      <div class="card-body">${planFormHtml(plan)}</div>
      <div class="card-footer">
        ${plan ? `<span class="badge ${plan.isActive ?? plan.is_active ? "badge-success" : "badge-neutral"}">${plan.isActive ?? plan.is_active ? "Active" : "Inactive"}</span>` : ""}
        <button class="btn btn-primary" id="ap-save">${plan ? "Save changes" : "Set up plan"}</button>
      </div>
    </div>`;

  document.getElementById("ap-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById("ap-error");
    errEl.hidden = true;
    setButtonLoading(btn, true);

    const priceInput = Number(document.getElementById("ap-price").value);
    const body = {
      price: Math.round(priceInput * 100), // smallest currency unit, matching Razorpay's own representation
      currency: document.getElementById("ap-currency").value.trim().toUpperCase(),
      razorpayPlanId: document.getElementById("ap-razorpay-id").value.trim() || null,
      isActive: document.getElementById("ap-active").checked,
    };

    try {
      await superAdminApi.upsertAgencyPlan(body);
      toastSuccess(plan ? "Agency plan updated." : "Agency plan created.");
      await refresh(container);
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
      toastError("Couldn't save the Agency plan.");
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "plans", title: "Agency Subscription Plan" });
  if (!content) return;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Agency Subscription Plan</h2>
        <p class="page-subtitle">The one plan every Agency subscribes to — set its price, currency, and the Razorpay Plan it references.</p>
      </div>
    </div>
    <div id="plan-card"></div>
  `;
  await refresh(document.getElementById("plan-card"));
}

main();
