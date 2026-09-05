import { requireRole, getCurrentUser } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { clientBillingApi } from "../api/resources.js";
import { confirmDialog } from "../components/modal.js";
import { toast, toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatMoney, formatDateTime } from "../components/ui.js";

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let checkoutScriptPromise = null;

// Loaded on demand, same pattern as agency-billing.js's own loader (no
// shared module exists for this yet — kept as a small, deliberate
// duplication rather than refactoring an unrelated file this step).
// Razorpay Checkout itself is the ONLY thing that ever collects payment
// details; this app never builds a card form and never sees card data.
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

/**
 * Opens Razorpay's own hosted Checkout for an already-created Order,
 * authenticated with the AGENCY's own public_token (never the platform's
 * key_id, never an access_token — see clientBillingService.js's response
 * shape) — verified against Razorpay's own Technology Partner "Process
 * Payments" Checkout example (key/amount/currency/order_id/prefill/theme).
 *
 * IMPORTANT: `onSettled` only ever reports what the BROWSER perceived
 * (submitted vs. dismissed) — neither outcome is treated as proof of
 * payment anywhere in this file. Only a future webhook (Step 8D) may ever
 * mark a subscription active; this function never calls any activation
 * endpoint and never mutates subscription status itself.
 */
async function openCheckout({ razorpayOrderId, amount, currency, publicToken, planName }, onSettled) {
  try {
    await loadCheckoutScript();
  } catch (err) {
    toastError(err.message);
    return;
  }

  const user = getCurrentUser();
  const razorpay = new window.Razorpay({
    key: publicToken,
    order_id: razorpayOrderId,
    amount,
    currency,
    name: "Client Subscription",
    description: planName ? `Subscription — ${planName}` : "Subscription",
    prefill: { name: user?.name || "", email: user?.email || "" },
    theme: { color: "#4f46e5" },
    // Browser-perceived success only — never trusted as payment proof.
    handler: () => onSettled("submitted"),
    modal: { ondismiss: () => onSettled("dismissed") },
  });
  razorpay.open();
}

/**
 * Step 8D: a short, bounded poll of the backend's own subscription state
 * after a browser-perceived "submitted" outcome — never a substitute for
 * the webhook, purely a UX nicety so the page updates itself once the
 * (asynchronous) webhook has actually confirmed activation, without
 * requiring a manual refresh. Mirrors agency-billing.js's own
 * pollForActivation exactly (~60s bound at 3s intervals). If the bound is
 * reached, the page simply stays in its current, truthful state — it
 * never assumes success.
 *
 * `isDone` is the caller's own "has this settled yet?" check — default
 * (initial purchase/retry) is "no longer pending". Step 10's upgrade flow
 * passes its own (status stays 'active' throughout, so "pending" is never
 * the right signal — `!subscription.upgradePending` is).
 */
function pollForActivation(content, attempt = 0, isDone = (s) => s.status !== "pending") {
  const MAX_ATTEMPTS = 20;
  if (attempt >= MAX_ATTEMPTS) return;
  setTimeout(async () => {
    try {
      const { subscription } = await clientBillingApi.subscription();
      if (subscription && isDone(subscription)) {
        await render(content);
        return;
      }
    } catch {
      /* keep polling */
    }
    pollForActivation(content, attempt + 1, isDone);
  }, 3000);
}

// Step 8B created real Razorpay Orders; Step 8C opened real Checkout
// against them; Step 8D's webhook is now what actually activates a
// subscription — this file itself still NEVER activates anything client-
// side. Every status here is rendered honestly, with no wording implying
// activation has happened in the browser.
const STATUS_LABEL = {
  pending: "Selected — awaiting payment setup",
  active: "Active",
  grace_period: "Grace period",
  cancelled: "Cancelled",
  expired: "Expired",
};
const STATUS_BADGE = {
  pending: "badge-warning",
  active: "badge-success",
  grace_period: "badge-warning",
  cancelled: "badge-neutral",
  expired: "badge-neutral",
};
const BILLING_CYCLE_LABEL = { monthly: "Monthly", yearly: "Yearly" };

function planCardHtml(plan, { actionHtml = "" } = {}) {
  return `
    <div class="card" style="max-width:320px">
      <div class="card-header"><h3 class="card-title">${escapeHtml(plan.name)}</h3></div>
      <div class="card-body flex-col gap-2">
        <div><span class="stat-value" style="font-size:1.5rem">${formatMoney(plan.price, plan.currency)}</span> <span class="text-tertiary text-sm">/ ${BILLING_CYCLE_LABEL[plan.billingCycle] || plan.billingCycle}</span></div>
        <div class="text-sm text-secondary">Employee limit: <strong class="num">${plan.maxActiveEmployees}</strong></div>
      </div>
      ${actionHtml ? `<div class="card-footer">${actionHtml}</div>` : ""}
    </div>`;
}

async function renderPlanPicker(container, { onChoose }) {
  let plans;
  try {
    ({ plans } = await clientBillingApi.plans());
  } catch (err) {
    container.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load plans", desc: err.message });
    return;
  }
  if (!plans.length) {
    container.innerHTML = emptyState({ icon: "$", title: "No plans available yet", desc: "Your agency hasn't published any subscription plans yet — check back soon or contact your agency administrator." });
    return;
  }
  container.innerHTML = `<div class="flex gap-4" style="flex-wrap:wrap">${plans
    .map((p) => planCardHtml(p, { actionHtml: `<button class="btn btn-primary w-full" data-choose="${p.id}">Choose this plan</button>` }))
    .join("")}</div>`;
  container.querySelectorAll("[data-choose]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      setButtonLoading(e.currentTarget, true);
      try {
        await onChoose(Number(e.currentTarget.dataset.choose));
      } finally {
        setButtonLoading(e.currentTarget, false);
      }
    })
  );
}

async function render(content) {
  content.innerHTML = `<div class="skeleton skeleton-row"></div>`;

  let subscription, plan, nextPlan;
  try {
    ({ subscription, plan, nextPlan } = await clientBillingApi.subscription());
  } catch (err) {
    content.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load billing information", desc: err.message });
    return;
  }

  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Billing</h2><p class="page-subtitle">Your subscription to your agency's Client plans.</p></div>
    </div>
    <div id="billing-main"></div>
  `;
  const main = document.getElementById("billing-main");

  const choosePlan = async (planId) => {
    let result;
    try {
      result = await clientBillingApi.choose(planId);
    } catch (err) {
      toastError(err.message);
      return;
    }

    if (!result.checkout || !result.checkout.razorpayOrderId || !result.checkout.publicToken) {
      // Order/subscription was created locally, but required Checkout data
      // is missing — never open a broken/incomplete Checkout. The
      // subscription stays pending; show a truthful error, not a fake
      // success message.
      toastError("Your plan was selected, but payment setup could not be started. Contact your agency administrator.");
      await render(content);
      return;
    }

    await openCheckout(
      { razorpayOrderId: result.checkout.razorpayOrderId, amount: result.checkout.amount, currency: result.checkout.currency, publicToken: result.checkout.publicToken, planName: result.plan?.name },
      (outcome) => {
        // Neither outcome is payment proof — only the Step 8D webhook may
        // ever activate this subscription. Both branches just show a
        // truthful status and re-render from the backend's own state;
        // "submitted" additionally polls briefly since the webhook is
        // asynchronous and may arrive a few seconds after the browser's
        // own callback fires.
        if (outcome === "submitted") {
          toast("Payment submitted. Waiting for payment confirmation.");
          render(content);
          pollForActivation(content);
        } else {
          toast("Checkout closed. Your plan is selected — you can complete payment any time.");
          render(content);
        }
      }
    );
  };

  // No subscription yet, or the previous one has fully ended — show the
  // plan picker.
  if (!subscription || ["cancelled", "expired"].includes(subscription.status)) {
    main.innerHTML = `
      <div class="mb-4">
        ${
          subscription
            ? emptyState({ icon: "◻", title: `Your previous subscription ${subscription.status}`, desc: "Choose a plan below to start a new subscription." })
            : emptyState({ icon: "$", title: "Choose a plan to get started", desc: "CRM access unlocks once your subscription is active." })
        }
      </div>
      <div id="plan-picker"></div>`;
    await renderPlanPicker(document.getElementById("plan-picker"), { onChoose: choosePlan });
    return;
  }

  // Step 8E: any 'pending' subscription that already has an outstanding
  // Order is retryable — covers both an explicit payment.failed and a
  // simply-abandoned/never-completed Checkout attempt alike, without
  // over-claiming knowledge of which one happened. Step 10: the same
  // ambiguous-but-safe reasoning applies to a failed/abandoned UPGRADE
  // payment (upgradePending) — retry (backend) handles both cases.
  const isUpgradeRetry = !!subscription.upgradePending;
  const isRetryable = subscription.status === "pending" || isUpgradeRetry;

  const retryPayment = async () => {
    let result;
    try {
      result = await clientBillingApi.retry();
    } catch (err) {
      toastError(err.message);
      return;
    }
    if (!result.checkout || !result.checkout.razorpayOrderId || !result.checkout.publicToken) {
      toastError("Could not start a new payment attempt. Contact your agency administrator.");
      await render(content);
      return;
    }
    if (isUpgradeRetry && typeof result.proration?.amountDue === "number") {
      toast(`Retrying upgrade to ${result.plan?.name || "the selected plan"} — ${formatMoney(result.proration.amountDue, result.checkout.currency)} due now.`);
    }
    await openCheckout(
      { razorpayOrderId: result.checkout.razorpayOrderId, amount: result.checkout.amount, currency: result.checkout.currency, publicToken: result.checkout.publicToken, planName: result.plan?.name },
      (outcome) => {
        if (outcome === "submitted") {
          toast("Payment submitted. Waiting for payment confirmation.");
          render(content);
          pollForActivation(content, 0, isUpgradeRetry ? (s) => !s.upgradePending : undefined);
        } else {
          toast("Checkout closed. You can try again any time.");
          render(content);
        }
      }
    );
  };

  // Step 9B: an active/grace_period subscription with an outstanding
  // renewal Order — the Client must actively pay it (this app has no
  // saved payment method / real Razorpay Subscription to auto-charge;
  // every renewal is its own one-off Order, exactly like the initial
  // purchase).
  const isRenewalDue = !!subscription.renewalDue;

  const payRenewal = async () => {
    let result;
    try {
      result = await clientBillingApi.payRenewal();
    } catch (err) {
      toastError(err.message);
      return;
    }
    if (!result.checkout || !result.checkout.razorpayOrderId || !result.checkout.publicToken) {
      toastError("Could not start the renewal payment. Contact your agency administrator.");
      await render(content);
      return;
    }
    await openCheckout(
      { razorpayOrderId: result.checkout.razorpayOrderId, amount: result.checkout.amount, currency: result.checkout.currency, publicToken: result.checkout.publicToken, planName: result.plan?.name },
      (outcome) => {
        if (outcome === "submitted") {
          toast("Payment submitted. Waiting for payment confirmation.");
          render(content);
          pollForActivation(content);
        } else {
          toast("Checkout closed. You can complete your renewal payment any time.");
          render(content);
        }
      }
    );
  };

  // Step 10 — upgrade: immediate, prorated, paid via Checkout — but NEVER
  // marked active from the browser callback (only the webhook does that,
  // same discipline as choosePlan/retryPayment/payRenewal above). Only
  // offered when genuinely eligible: active, and no OTHER payment already
  // pending (renewal or a prior upgrade attempt) — mirrors the backend's
  // own "confirm there is no existing pending payment Order" precondition.
  const canRequestUpgrade = subscription.status === "active" && !isRenewalDue && !subscription.upgradePending;

  const requestUpgrade = async (planId) => {
    let result;
    try {
      result = await clientBillingApi.upgrade(planId);
    } catch (err) {
      toastError(err.message);
      return;
    }
    if (!result.checkout || !result.checkout.razorpayOrderId || !result.checkout.publicToken) {
      toastError("Could not start the upgrade payment. Contact your agency administrator.");
      await render(content);
      return;
    }
    if (typeof result.proration?.amountDue === "number") {
      toast(`Upgrading to ${result.plan?.name || "the selected plan"} — ${formatMoney(result.proration.amountDue, result.checkout.currency)} due now.`);
    }
    await openCheckout(
      { razorpayOrderId: result.checkout.razorpayOrderId, amount: result.checkout.amount, currency: result.checkout.currency, publicToken: result.checkout.publicToken, planName: result.plan?.name },
      (outcome) => {
        // Browser-perceived only — never proof of payment. Only the
        // webhook (handleUpgradePaymentSuccess) ever changes plan_id.
        if (outcome === "submitted") {
          toast("Payment processing. Your plan will update once payment is confirmed.");
          render(content);
          pollForActivation(content, 0, (s) => !s.upgradePending);
        } else {
          toast("Checkout closed. You can complete your upgrade payment any time.");
          render(content);
        }
      }
    );
  };

  // Step 10 — downgrade request/replace. No payment, no Checkout — see
  // clientBillingService.requestDowngrade's own comment. Only offered
  // while the subscription is genuinely running (active/grace_period);
  // "lower" mirrors the backend's own definition (target plan price <
  // the subscription's current APPLICABLE price, i.e. currentPrice, never
  // the live current plan price).
  const canRequestDowngrade = ["active", "grace_period"].includes(subscription.status);

  const requestDowngrade = async (planId) => {
    try {
      await clientBillingApi.downgrade(planId);
    } catch (err) {
      toastError(err.message);
      return;
    }
    toastSuccess("Downgrade scheduled — it takes effect at your next renewal.");
    await render(content);
  };

  // pending / active / grace_period — show current selection/status.
  main.innerHTML = `
    <div class="card">
      <div class="card-body flex-col gap-4">
        ${
          isRetryable
            ? `<div class="alert alert-warning"><span>⚠</span><span>${isUpgradeRetry ? "Upgrade payment not completed yet. You can try again." : "Payment failed. You can try again."}</span></div>`
            : ""
        }
        ${
          subscription.status === "grace_period"
            ? `<div class="alert alert-warning"><span>⚠</span><span>Your subscription is in its grace period${subscription.gracePeriodEndsAt ? ` until ${escapeHtml(formatDateTime(subscription.gracePeriodEndsAt))}` : ""}. Pay now to keep access.</span></div>`
            : ""
        }
        ${
          isRenewalDue && subscription.status === "active"
            ? `<div class="alert alert-warning"><span>⚠</span><span>Your renewal payment is due. Pay now to avoid losing access.</span></div>`
            : ""
        }
        ${
          nextPlan
            ? `<div class="alert alert-info" style="margin:0"><span>ⓘ</span><span>Scheduled to switch to <strong>${escapeHtml(nextPlan.name)}</strong> (${formatMoney(nextPlan.price, nextPlan.currency)}/${BILLING_CYCLE_LABEL[nextPlan.billingCycle] || nextPlan.billingCycle}) at your next renewal${subscription.currentPeriodEnd ? ` on ${escapeHtml(formatDateTime(subscription.currentPeriodEnd))}` : ""}.</span></div>`
            : ""
        }
        <div class="field-row">
          <div>
            <span class="label">Plan</span>
            <p>${plan ? escapeHtml(plan.name) : "—"}</p>
          </div>
          <div>
            <span class="label">Billing cycle</span>
            <p>${plan ? BILLING_CYCLE_LABEL[plan.billingCycle] || plan.billingCycle : "—"}</p>
          </div>
          <div>
            <span class="label">Status</span>
            <p><span class="badge ${STATUS_BADGE[subscription.status] || "badge-neutral"}">${STATUS_LABEL[subscription.status] || subscription.status}</span></p>
          </div>
          <div>
            <span class="label">Current period ends</span>
            <p>${subscription.currentPeriodEnd ? formatDateTime(subscription.currentPeriodEnd) : "—"}</p>
          </div>
        </div>
        ${!subscription.autoRenew ? `<div class="alert alert-warning" style="margin:0"><span>ⓘ</span><span>Auto-renewal is off — access continues until the current period ends, then this subscription will end.</span></div>` : ""}
        <div class="flex gap-3">
          ${isRetryable ? `<button class="btn btn-primary" id="retry-btn">Retry Payment</button>` : ""}
          ${isRenewalDue ? `<button class="btn btn-primary" id="pay-renewal-btn">Pay Renewal</button>` : ""}
          ${
            subscription.autoRenew && ["pending", "active", "grace_period"].includes(subscription.status)
              ? `<button class="btn btn-secondary" id="cancel-btn">Cancel subscription</button>`
              : ""
          }
        </div>
      </div>
    </div>
    ${canRequestUpgrade ? `<div class="mt-4"><h3 class="card-title mb-2">Upgrade</h3><div id="upgrade-picker"></div></div>` : ""}
    ${canRequestDowngrade ? `<div class="mt-4"><h3 class="card-title mb-2">Change plan</h3><div id="downgrade-picker"></div></div>` : ""}`;

  const retryBtn = document.getElementById("retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", async () => {
      setButtonLoading(retryBtn, true);
      try {
        await retryPayment();
      } finally {
        setButtonLoading(retryBtn, false);
      }
    });
  }

  const payRenewalBtn = document.getElementById("pay-renewal-btn");
  if (payRenewalBtn) {
    payRenewalBtn.addEventListener("click", async () => {
      setButtonLoading(payRenewalBtn, true);
      try {
        await payRenewal();
      } finally {
        setButtonLoading(payRenewalBtn, false);
      }
    });
  }

  const cancelBtn = document.getElementById("cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Cancel subscription?",
        message: "This turns off auto-renewal. You keep access until the current period ends, then the subscription ends.",
        confirmLabel: "Cancel subscription",
        danger: true,
      });
      if (!ok) return;
      try {
        await clientBillingApi.cancel();
        toastSuccess("Subscription set to not renew.");
        await render(content);
      } catch (err) {
        toastError(err.message);
      }
    });
  }

  const upgradePicker = document.getElementById("upgrade-picker");
  const downgradePicker = document.getElementById("downgrade-picker");
  if (upgradePicker || downgradePicker) {
    let plans = [];
    let loadError = null;
    try {
      ({ plans } = await clientBillingApi.plans());
    } catch (err) {
      loadError = err;
    }

    if (upgradePicker) {
      if (loadError) {
        upgradePicker.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load plans", desc: loadError.message });
      } else {
        // "Higher" mirrors the backend: strictly greater than the current
        // APPLICABLE price (currentPrice) — never the live current plan price.
        const higherPlans = plans.filter((p) => p.id !== plan?.id && p.price > subscription.currentPrice);
        if (!higherPlans.length) {
          upgradePicker.innerHTML = `<p class="text-sm text-tertiary">No higher-priced plans are available right now.</p>`;
        } else {
          upgradePicker.innerHTML = `<div class="flex gap-4" style="flex-wrap:wrap">${higherPlans
            .map((p) => planCardHtml(p, { actionHtml: `<button class="btn btn-primary w-full" data-upgrade="${p.id}">Upgrade to this plan</button>` }))
            .join("")}</div>
            <p class="text-sm text-tertiary mt-2">Upgrading is immediate — you'll pay a prorated amount now, and your plan changes as soon as payment is confirmed.</p>`;
          upgradePicker.querySelectorAll("[data-upgrade]").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
              setButtonLoading(e.currentTarget, true);
              try {
                await requestUpgrade(Number(e.currentTarget.dataset.upgrade));
              } finally {
                setButtonLoading(e.currentTarget, false);
              }
            });
          });
        }
      }
    }

    if (downgradePicker) {
      if (loadError) {
        downgradePicker.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load plans", desc: loadError.message });
      } else {
        // "Lower" mirrors the backend: strictly less than the current
        // APPLICABLE price (currentPrice) — never the live current plan price.
        const lowerPlans = plans.filter((p) => p.id !== plan?.id && p.price < subscription.currentPrice);
        if (!lowerPlans.length) {
          downgradePicker.innerHTML = `<p class="text-sm text-tertiary">No lower-priced plans are available right now.</p>`;
        } else {
          downgradePicker.innerHTML = `<div class="flex gap-4" style="flex-wrap:wrap">${lowerPlans
            .map((p) =>
              planCardHtml(p, {
                actionHtml: `<button class="btn btn-secondary w-full" data-downgrade="${p.id}">${nextPlan?.id === p.id ? "Downgrade scheduled" : "Downgrade to this plan"}</button>`,
              })
            )
            .join("")}</div>
            <p class="text-sm text-tertiary mt-2">Downgrading takes effect at your next renewal — no payment is taken now, and you keep your current plan until then.</p>`;
          downgradePicker.querySelectorAll("[data-downgrade]").forEach((btn) => {
            if (Number(btn.dataset.downgrade) === nextPlan?.id) {
              btn.disabled = true;
              return;
            }
            btn.addEventListener("click", async (e) => {
              setButtonLoading(e.currentTarget, true);
              try {
                await requestDowngrade(Number(e.currentTarget.dataset.downgrade));
              } finally {
                setButtonLoading(e.currentTarget, false);
              }
            });
          });
        }
      }
    }
  }
}

async function main() {
  const user = await requireRole("client_admin");
  if (!user) return;
  // allowBlocked: this is the one page a locked-out Client must be able to
  // reach to fix it — mirrors agency-billing.js's own allowBlocked usage.
  const content = mountShell({ activeKey: "billing", title: "Billing", allowBlocked: true });
  if (!content) return;
  await applyTenantBranding();
  await render(content);
}

main();
