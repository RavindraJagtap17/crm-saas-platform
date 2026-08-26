import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { openModal } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatMoney } from "../components/ui.js";

const BILLING_CYCLES = ["daily", "weekly", "monthly", "yearly"];

// Simple "key: value" per line — deliberately not a JSON textarea (this is
// a Super Admin catalog tool, not a developer console) and deliberately
// not a repeatable key/value widget (§P: "do not create advanced billing
// analytics" — keep this proportionate to Phase 1's actual need).
function parseFeaturesText(text) {
  const obj = {};
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return;
      obj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
  return Object.keys(obj).length ? obj : null;
}
function featuresToText(features) {
  if (!features || typeof features !== "object") return "";
  return Object.entries(features)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function openPlanForm(listEl, plan) {
  const isEdit = !!plan;
  openModal({
    title: isEdit ? "Edit plan" : "New plan",
    bodyHtml: `
      <form id="plan-form" novalidate>
        <div class="field">
          <label class="label" for="pf-name">Name</label>
          <input class="input" id="pf-name" value="${escapeHtml(plan?.name || "")}" placeholder="e.g. Growth" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="pf-price">Price</label>
            <input class="input" type="number" min="0" step="0.01" id="pf-price" value="${plan ? (plan.price / 100).toFixed(2) : ""}" placeholder="999.00" />
            <span class="hint">Same amount you set for this Plan in the Razorpay Dashboard.</span>
          </div>
          <div class="field">
            <label class="label" for="pf-currency">Currency</label>
            <input class="input" id="pf-currency" value="${escapeHtml(plan?.currency || "INR")}" maxlength="3" style="text-transform:uppercase" />
          </div>
        </div>
        <div class="field">
          <label class="label" for="pf-cycle">Billing cycle</label>
          <select class="select" id="pf-cycle">
            ${BILLING_CYCLES.map((c) => `<option value="${c}" ${plan?.billing_cycle === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label class="label" for="pf-razorpay-id">Razorpay Plan ID ${isEdit ? "" : ""}</label>
          <input class="input" id="pf-razorpay-id" value="${escapeHtml(plan?.razorpay_plan_id || "")}" placeholder="plan_ABC123xyz" ${isEdit ? "disabled" : ""} />
          <span class="hint">From the Razorpay Dashboard → Plans. Created there first — this app never creates or edits a Razorpay Plan itself. Fixed after creation (a different Razorpay Plan means a different local plan).</span>
        </div>
        <div class="field">
          <label class="label" for="pf-features">Features <span class="optional">(one "key: value" per line, optional)</span></label>
          <textarea class="textarea" id="pf-features" placeholder="leads: unlimited&#10;employees: 10">${escapeHtml(featuresToText(plan?.features))}</textarea>
        </div>
        <div class="field-error" id="pf-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="pf-submit">${isEdit ? "Save changes" : "Create plan"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#pf-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#pf-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);

        const priceInput = Number(modalEl.querySelector("#pf-price").value);
        const body = {
          name: modalEl.querySelector("#pf-name").value.trim(),
          price: Math.round(priceInput * 100), // smallest currency unit, matching Razorpay's own representation
          currency: modalEl.querySelector("#pf-currency").value.trim().toUpperCase(),
          billingCycle: modalEl.querySelector("#pf-cycle").value,
          features: parseFeaturesText(modalEl.querySelector("#pf-features").value),
          ...(isEdit ? {} : { razorpayPlanId: modalEl.querySelector("#pf-razorpay-id").value.trim() }),
        };

        try {
          if (isEdit) await superAdminApi.updatePlan(plan.id, body);
          else await superAdminApi.createPlan(body);
          closeFn();
          toastSuccess(isEdit ? "Plan updated." : "Plan created.");
          await refresh(listEl);
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

async function refresh(listEl) {
  listEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let plans;
  try {
    ({ plans } = await superAdminApi.listPlans());
  } catch (err) {
    listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load plans", desc: err.message })}</div>`;
    return;
  }

  if (!plans.length) {
    listEl.innerHTML = `<div class="card-body">${emptyState({
      icon: "$",
      title: "No plans yet",
      desc: "Create a Plan in the Razorpay Dashboard first, then register it here so tenants can subscribe to it.",
    })}</div>`;
    return;
  }

  listEl.innerHTML = `
    <div class="table-wrap" style="border:none;border-radius:0">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Price</th><th>Cycle</th><th>Razorpay Plan ID</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${plans
            .map(
              (p) => `
            <tr>
              <td data-label="Name" class="table-cell-primary">${escapeHtml(p.name)}</td>
              <td data-label="Price">${formatMoney(p.price, p.currency)}</td>
              <td data-label="Cycle">${escapeHtml(p.billing_cycle)}</td>
              <td data-label="Razorpay Plan ID" class="table-cell-muted text-xs">${escapeHtml(p.razorpay_plan_id)}</td>
              <td data-label="Status">${p.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
              <td data-label="" class="flex gap-2">
                <button class="btn btn-secondary btn-sm" data-edit="${p.id}">Edit</button>
                <button class="btn btn-ghost btn-sm" data-toggle="${p.id}" data-active="${p.is_active ? 1 : 0}">${p.is_active ? "Deactivate" : "Activate"}</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  listEl.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openPlanForm(listEl, plans.find((p) => String(p.id) === btn.dataset.edit)))
  );
  listEl.querySelectorAll("[data-toggle]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const nextActive = btn.dataset.active !== "1";
      try {
        await superAdminApi.setPlanActive(btn.dataset.toggle, nextActive);
        toastSuccess(nextActive ? "Plan activated." : "Plan deactivated — existing subscribers are unaffected.");
        await refresh(listEl);
      } catch (err) {
        toastError(err.message);
      }
    })
  );
}

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "plans", title: "Plan Catalog" });

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Plan Catalog</h2>
        <p class="page-subtitle">Local plans tenants can subscribe to — each references a Plan already created in the Razorpay Dashboard. Razorpay Plans can't be edited or deleted here, only referenced.</p>
      </div>
      <button class="btn btn-primary" id="new-btn">+ New Plan</button>
    </div>
    <div class="card" id="list"></div>
  `;
  document.getElementById("new-btn").addEventListener("click", () => openPlanForm(document.getElementById("list")));
  await refresh(document.getElementById("list"));
}

main();
