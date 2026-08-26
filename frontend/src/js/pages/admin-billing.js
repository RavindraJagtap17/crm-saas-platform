import { requireRole, getCurrentUser } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { tenantApi, billingApi } from "../api/resources.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatMoney, formatDateTime, accountStatusBadge } from "../components/ui.js";

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let checkoutScriptPromise = null;

// Loaded on demand (not on every page view) — Razorpay's own hosted
// Checkout widget is the ONLY thing that ever collects payment details;
// this app never builds a card form and never sees card data (§E).
function loadCheckoutScript() {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScriptPromise) {
    checkoutScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = RAZORPAY_CHECKOUT_SRC;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Razorpay Checkout. Check your connection and try again."));
      document.head.appendChild(script);
    });
  }
  return checkoutScriptPromise;
}

const PENDING_STATUSES = ["created", "authenticated", "pending"];
const ENDED_STATUSES = ["cancelled", "completed", "expired"];

const SUBSCRIPTION_STATUS_LABEL = {
  created: "Awaiting payment",
  authenticated: "Payment authorized — confirming",
  active: "Active",
  pending: "Payment retrying",
  halted: "Halted (payment failing)",
  paused: "Suspended by platform",
  cancelled: "Cancelled",
  completed: "Completed",
  expired: "Expired",
};
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

/**
 * §E/§G: opens Razorpay's own hosted Checkout for an existing (already
 * backend-created) subscription — never a card form of our own. The
 * `handler` callback fires on the browser's own idea of success, which is
 * NEVER treated as authoritative (§G/§H): it only triggers a short poll of
 * OUR OWN backend, which only reflects "active" once the Razorpay webhook
 * has actually confirmed it.
 */
async function openCheckout({ razorpaySubscriptionId, planName }, onSettled) {
  try {
    await loadCheckoutScript();
  } catch (err) {
    toastError(err.message);
    return;
  }

  const user = getCurrentUser();
  const razorpay = new window.Razorpay({
    key: window.CRM_CONFIG?.RAZORPAY_KEY_ID || "",
    subscription_id: razorpaySubscriptionId,
    name: "CRM Subscription",
    description: planName ? `Subscription — ${planName}` : "Subscription",
    prefill: { name: user?.name || "", email: user?.email || "" },
    theme: { color: "#4f46e5" },
    handler: () => onSettled("submitted"),
    modal: { ondismiss: () => onSettled("dismissed") },
  });
  razorpay.open();
}

function pollForActivation(statusEl, attempt = 0) {
  const MAX_ATTEMPTS = 20; // ~60s at 3s intervals — a bounded wait, not indefinite polling
  if (attempt >= MAX_ATTEMPTS) {
    statusEl.innerHTML = `<div class="alert alert-warning"><span>⏳</span><span>Still waiting on confirmation from Razorpay. This can take a minute — refresh this page shortly to check again.</span></div>`;
    return;
  }
  setTimeout(async () => {
    try {
      const { subscription } = await billingApi.subscription();
      if (subscription && !PENDING_STATUSES.includes(subscription.status)) {
        window.location.reload();
        return;
      }
    } catch {
      /* keep polling */
    }
    pollForActivation(statusEl, attempt + 1);
  }, 3000);
}

function planCardHtml(plan, { selected = false, actionHtml = "" } = {}) {
  const features = plan.features && typeof plan.features === "object" ? Object.entries(plan.features) : [];
  return `
    <div class="card ${selected ? "" : ""}" style="max-width:320px">
      <div class="card-header"><h3 class="card-title">${escapeHtml(plan.name)}</h3></div>
      <div class="card-body flex-col gap-2">
        <div><span class="stat-value" style="font-size:1.5rem">${formatMoney(plan.price, plan.currency)}</span> <span class="text-tertiary text-sm">/ ${escapeHtml(plan.billingCycle || plan.billing_cycle)}</span></div>
        ${
          features.length
            ? `<ul class="text-sm text-secondary" style="padding-left:1.1em">${features.map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(String(v))}</li>`).join("")}</ul>`
            : ""
        }
      </div>
      ${actionHtml ? `<div class="card-footer">${actionHtml}</div>` : ""}
    </div>`;
}

async function renderPlanPicker(container, plans, { onSubscribe }) {
  if (!plans.length) {
    container.innerHTML = emptyState({ icon: "$", title: "No plans available", desc: "Your platform administrator hasn't published any subscription plans yet." });
    return;
  }
  container.innerHTML = `<div class="flex gap-4" style="flex-wrap:wrap">${plans
    .map((p) => planCardHtml(p, { actionHtml: `<button class="btn btn-primary w-full" data-subscribe="${p.id}">Subscribe</button>` }))
    .join("")}</div>`;

  container.querySelectorAll("[data-subscribe]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const target = e.currentTarget;
      setButtonLoading(target, true);
      try {
        await onSubscribe(Number(target.dataset.subscribe));
      } finally {
        setButtonLoading(target, false);
      }
    })
  );
}

function openChangePlanModal(currentPlanId, plans, onChanged) {
  const selectable = plans.filter((p) => p.id !== currentPlanId);
  openModal({
    title: "Change plan",
    bodyHtml: `
      <form id="cp-form" novalidate>
        <div class="field">
          <label class="label" for="cp-plan">New plan</label>
          <select class="select" id="cp-plan">
            ${selectable.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} — ${formatMoney(p.price, p.currency)}/${escapeHtml(p.billingCycle)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label class="label">When should this take effect?</label>
          <div class="flex-col gap-2">
            <label class="text-sm flex items-center gap-2"><input type="radio" name="cp-timing" value="now" checked /> Immediately</label>
            <label class="text-sm flex items-center gap-2"><input type="radio" name="cp-timing" value="cycle_end" /> At the end of the current billing cycle</label>
          </div>
          <span class="hint">This is exactly what Razorpay itself supports for a plan change — nothing is prorated or backdated beyond what Razorpay confirms.</span>
        </div>
        <div class="field-error" id="cp-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="cp-submit">Request change</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#cp-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#cp-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const planId = Number(modalEl.querySelector("#cp-plan").value);
        const timing = modalEl.querySelector('input[name="cp-timing"]:checked').value;
        try {
          const result = await billingApi.changePlan(planId, timing);
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

async function render(content) {
  content.innerHTML = `<div class="skeleton skeleton-row"></div>`;

  let tenant, subscription, plan, plans, payments;
  try {
    [{ tenant }, { subscription, plan }, { plans }, { payments }] = await Promise.all([
      tenantApi.get(),
      billingApi.subscription(),
      billingApi.plans(),
      billingApi.payments(),
    ]);
  } catch (err) {
    content.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load billing information", desc: err.message });
    return;
  }

  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Billing</h2><p class="page-subtitle">Your subscription and payment history.</p></div>
      ${accountStatusBadge(tenant.status)}
    </div>
    <div id="billing-main" class="mb-6"></div>
    <div class="card">
      <div class="card-header"><h3 class="card-title">Recent payments</h3></div>
      <div id="payments-list"></div>
    </div>
  `;

  const main = document.getElementById("billing-main");
  const paymentsEl = document.getElementById("payments-list");

  // ---- Payments ledger ----
  if (!payments.length) {
    paymentsEl.innerHTML = `<div class="card-body">${emptyState({ icon: "$", title: "No payments yet" })}</div>`;
  } else {
    paymentsEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Amount</th><th>Status</th><th>Paid</th></tr></thead>
          <tbody>
            ${payments
              .map(
                (p) => `
              <tr>
                <td data-label="Amount">${formatMoney(p.amount, p.currency)}</td>
                <td data-label="Status"><span class="badge ${p.status === "captured" ? "badge-success" : "badge-danger"}">${escapeHtml(p.status)}</span></td>
                <td data-label="Paid">${p.paid_at ? formatDateTime(p.paid_at) : "—"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  // ---- Main subscription panel ----

  if (!subscription) {
    main.innerHTML = `
      <div class="mb-4">
        ${emptyState({ icon: "$", title: "Choose a plan to get started", desc: "Your agency's workspace unlocks as soon as your subscription is confirmed." })}
      </div>
      <div id="plan-picker"></div>`;
    await renderPlanPicker(document.getElementById("plan-picker"), plans, {
      onSubscribe: async (planId) => {
        try {
          const result = await billingApi.subscribe(planId);
          toastSuccess("Redirecting to Razorpay Checkout…");
          openCheckout(result.checkout, (outcome) => {
            if (outcome === "submitted") {
              main.innerHTML = `<div class="card"><div class="card-body">${emptyState({
                icon: "⏳",
                title: "Confirming your payment…",
                desc: "Razorpay is processing this. Your workspace unlocks automatically once it's confirmed — this can take a few seconds.",
              })}</div></div>`;
              pollForActivation(main);
            } else {
              render(content); // dismissed — show the "resume payment" state
            }
          });
        } catch (err) {
          toastError(err.message);
        }
      },
    });
    return;
  }

  if (PENDING_STATUSES.includes(subscription.status)) {
    main.innerHTML = `
      <div class="card">
        <div class="card-body flex-col gap-4">
          <div class="alert alert-warning"><span>⏳</span><span>${escapeHtml(SUBSCRIPTION_STATUS_LABEL[subscription.status])} — your workspace stays locked until Razorpay confirms this payment. This page never activates your account on its own; only a confirmed payment does.</span></div>
          ${plan ? planCardHtml(plan) : ""}
          <button class="btn btn-primary" id="resume-checkout-btn">Resume payment</button>
        </div>
      </div>`;
    document.getElementById("resume-checkout-btn").addEventListener("click", (e) => {
      setButtonLoading(e.currentTarget, true);
      openCheckout({ razorpaySubscriptionId: subscription.razorpaySubscriptionId, planName: plan?.name }, (outcome) => {
        setButtonLoading(e.currentTarget, false);
        if (outcome === "submitted") pollForActivation(main);
      });
    });
    return;
  }

  if (ENDED_STATUSES.includes(subscription.status)) {
    main.innerHTML = `<div class="card"><div class="card-body">${emptyState({
      icon: "◻",
      title: `Subscription ${escapeHtml(SUBSCRIPTION_STATUS_LABEL[subscription.status].toLowerCase())}`,
      desc: "Contact your platform administrator to reactivate your workspace.",
    })}</div></div>`;
    return;
  }

  // active / halted / paused — show the current plan, with Change Plan
  // available only when the subscription is genuinely active.
  main.innerHTML = `
    <div class="card">
      <div class="card-body flex-col gap-4">
        ${
          subscription.status !== "active"
            ? `<div class="alert alert-warning"><span>⚠</span><span>${escapeHtml(SUBSCRIPTION_STATUS_LABEL[subscription.status])}. This is managed by your platform administrator.</span></div>`
            : ""
        }
        <div class="field-row">
          <div>
            <span class="label">Plan</span>
            <p>${plan ? escapeHtml(plan.name) : "—"}</p>
          </div>
          <div>
            <span class="label">Status</span>
            <p><span class="badge ${SUBSCRIPTION_STATUS_BADGE[subscription.status] || "badge-neutral"}">${escapeHtml(SUBSCRIPTION_STATUS_LABEL[subscription.status] || subscription.status)}</span></p>
          </div>
          <div>
            <span class="label">Current period ends</span>
            <p>${subscription.currentPeriodEnd ? formatDateTime(subscription.currentPeriodEnd) : "—"}</p>
          </div>
        </div>
        ${subscription.status === "active" ? `<button class="btn btn-secondary" id="change-plan-btn">Change plan</button>` : ""}
      </div>
    </div>`;

  const changeBtn = document.getElementById("change-plan-btn");
  if (changeBtn) {
    changeBtn.addEventListener("click", () => openChangePlanModal(subscription.planId, plans, () => render(content)));
  }
}

async function main() {
  const user = await requireRole("tenant_admin");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "billing", title: "Billing", allowInactiveTenant: true });
  await render(content);
}

main();
