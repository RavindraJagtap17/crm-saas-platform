import { requireRole, getCurrentUser } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { tenantApi, billingApi, clientsApi } from "../api/resources.js";
import { confirmDialog } from "../components/modal.js";
import { toastSuccess, toastError, toast } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading, formatMoney, formatDateTime, accountStatusBadge } from "../components/ui.js";

/**
 * New business model — single-plan self-service Agency subscription
 * (agency_subscription_plan/agency_subscriptions, migrations 041/042).
 * Migrated off the OLD multi-plan subscriptionModel/subscription_plans
 * system (billingApi.subscription()/plans()/payments()/subscribe()/
 * changePlan()) — that system is never populated by the real signup flow
 * (authService.signUpAgency -> billingService.initiateAgencySubscription),
 * so this page previously showed an empty/incorrect state for every real
 * Agency. Its backend routes/service/model are left untouched (still used
 * by any tenant still on that old flow) but nothing here calls them.
 *
 * There is no per-Agency payment ledger for the new model yet (a
 * deliberate, pre-existing gap — see billingService.js/razorpayWebhookService.js's
 * own comments), so unlike the old page there is no "Recent payments"
 * section here: there is nothing correct to show.
 */

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let checkoutScriptPromise = null;

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

const STATUS_LABEL = {
  pending: "Awaiting payment",
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

/**
 * Opens Razorpay's own hosted Checkout for an existing subscription —
 * used both for the very first payment and for "resume payment" on a
 * pending/grace-period one. The `handler` callback fires on the browser's
 * own idea of success, which is NEVER treated as authoritative: only the
 * webhook (razorpayWebhookService.js) ever writes subscription status;
 * this only triggers a short poll of our own backend afterward.
 */
async function openCheckout({ razorpaySubscriptionId }, onSettled) {
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
    name: "Agency Subscription",
    description: "Agency Subscription",
    prefill: { name: user?.name || "", email: user?.email || "" },
    theme: { color: "#4f46e5" },
    handler: () => onSettled("submitted"),
    modal: { ondismiss: () => onSettled("dismissed") },
  });
  razorpay.open();
}

function pollForActivation(content, attempt = 0) {
  const MAX_ATTEMPTS = 20; // ~60s at 3s intervals — a bounded wait, not indefinite polling
  if (attempt >= MAX_ATTEMPTS) return;
  setTimeout(async () => {
    try {
      const { subscription } = await billingApi.getAgencySubscription();
      if (subscription && subscription.status !== "pending") {
        await render(content);
        return;
      }
    } catch {
      /* keep polling */
    }
    pollForActivation(content, attempt + 1);
  }, 3000);
}

async function renderClientLimitCard(container) {
  let limit, clients;
  try {
    [{ maxClients: limit }, { clients }] = await Promise.all([clientsApi.limit(), clientsApi.list()]);
  } catch {
    container.innerHTML = "";
    return;
  }
  const count = clients.length;
  const overLimit = limit !== null && count > limit;
  const limitLabel = limit === null ? "Unlimited" : String(limit);
  container.innerHTML = `
    <div class="card mb-6">
      <div class="card-body flex items-center justify-between" style="flex-wrap:wrap;gap:var(--space-3)">
        <div>
          <span class="label">Clients</span>
          <p class="stat-value" style="font-size:1.25rem">${count} <span class="text-tertiary" style="font-size:var(--text-md)">/ ${limitLabel}</span></p>
        </div>
        ${overLimit ? `<div class="alert alert-warning" style="margin:0"><span>⚠</span><span>Over your plan's client limit — existing clients are kept, but you can't add another until you're back under it.</span></div>` : ""}
      </div>
    </div>`;
}

async function render(content) {
  content.innerHTML = `<div class="skeleton skeleton-row"></div>`;

  let tenant, subscription, plan;
  try {
    [{ tenant }, { subscription, plan }] = await Promise.all([tenantApi.get(), billingApi.getAgencySubscription()]);
  } catch (err) {
    content.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load billing information", desc: err.message });
    return;
  }

  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Billing</h2><p class="page-subtitle">Your agency's subscription.</p></div>
      ${accountStatusBadge(tenant.status)}
    </div>
    <div id="client-limit-card"></div>
    <div id="billing-main"></div>
  `;

  await renderClientLimitCard(document.getElementById("client-limit-card"));
  const main = document.getElementById("billing-main");

  // ---- No subscription yet — show the one plan's price and a Subscribe
  // button. getAgencySubscription() only bundles plan info alongside an
  // EXISTING subscription, so the pre-subscribe price preview comes from
  // the public price-preview endpoint instead (same one the self-service
  // signup page shows before an account even exists). ----
  if (!subscription) {
    let previewPlan = null;
    try {
      ({ plan: previewPlan } = await billingApi.getAgencyPlan());
    } catch {
      /* preview is a nicety, not required to proceed */
    }

    main.innerHTML = `
      <div class="card">
        <div class="card-body flex-col gap-4">
          ${
            previewPlan
              ? `<div><span class="stat-value" style="font-size:1.5rem">${formatMoney(previewPlan.price, previewPlan.currency)}</span> <span class="text-tertiary text-sm">/ ${escapeHtml(previewPlan.billingCycle || "yearly")}</span></div>`
              : emptyState({ icon: "$", title: "Agency plan not available yet", desc: "Contact the platform administrator." })
          }
          ${previewPlan ? `<button class="btn btn-primary" id="subscribe-btn">Subscribe</button>` : ""}
        </div>
      </div>`;

    const subscribeBtn = document.getElementById("subscribe-btn");
    if (subscribeBtn) {
      subscribeBtn.addEventListener("click", async () => {
        setButtonLoading(subscribeBtn, true);
        try {
          const result = await billingApi.initiateAgencySubscription();
          toastSuccess("Redirecting to Razorpay Checkout…");
          openCheckout({ razorpaySubscriptionId: result.checkout.razorpaySubscriptionId }, (outcome) => {
            if (outcome === "submitted") {
              main.innerHTML = `<div class="card"><div class="card-body">${emptyState({
                icon: "⏳",
                title: "Confirming your payment…",
                desc: "Razorpay is processing this. Your workspace unlocks automatically once it's confirmed — this can take a few seconds.",
              })}</div></div>`;
              pollForActivation(content);
            } else {
              render(content); // dismissed — show the "resume payment" state
            }
          });
        } catch (err) {
          toastError(err.message);
        } finally {
          setButtonLoading(subscribeBtn, false);
        }
      });
    }
    return;
  }

  // ---- cancelled / expired — no self-service resubscribe path exists in
  // the current backend (initiateAgencySubscription rejects once any row
  // exists for this tenant, regardless of status) — see this task's final
  // report. Honest, non-actionable state, same as the old page's own
  // ended-state handling. ----
  if (["cancelled", "expired"].includes(subscription.status)) {
    main.innerHTML = `<div class="card"><div class="card-body">${emptyState({
      icon: "◻",
      title: `Subscription ${STATUS_LABEL[subscription.status].toLowerCase()}`,
      desc: "Contact the platform administrator to reactivate your agency's workspace.",
    })}</div></div>`;
    return;
  }

  const resumePayment = () => {
    const btn = document.getElementById("resume-checkout-btn");
    setButtonLoading(btn, true);
    openCheckout({ razorpaySubscriptionId: subscription.razorpaySubscriptionId }, (outcome) => {
      setButtonLoading(btn, false);
      if (outcome === "submitted") {
        toast("Payment submitted. Waiting for payment confirmation.");
        pollForActivation(content);
      }
    });
  };

  const isRetryable = ["pending", "grace_period"].includes(subscription.status);

  main.innerHTML = `
    <div class="card">
      <div class="card-body flex-col gap-4">
        ${
          subscription.status === "grace_period"
            ? `<div class="alert alert-warning"><span>⚠</span><span>Your subscription is in its grace period${subscription.gracePeriodEndsAt ? ` until ${escapeHtml(formatDateTime(subscription.gracePeriodEndsAt))}` : ""}. Pay now to keep access.</span></div>`
            : ""
        }
        ${
          subscription.status === "pending"
            ? `<div class="alert alert-warning"><span>⏳</span><span>Awaiting payment — your workspace stays locked until Razorpay confirms this. This page never activates your account on its own; only a confirmed payment does.</span></div>`
            : ""
        }
        <div class="field-row">
          <div>
            <span class="label">Price</span>
            <p>${plan ? `${formatMoney(plan.price, plan.currency)} / ${escapeHtml(plan.billingCycle || "yearly")}` : "—"}</p>
          </div>
          <div>
            <span class="label">Status</span>
            <p><span class="badge ${STATUS_BADGE[subscription.status] || "badge-neutral"}">${escapeHtml(STATUS_LABEL[subscription.status] || subscription.status)}</span></p>
          </div>
          <div>
            <span class="label">Current period ends</span>
            <p>${subscription.currentPeriodEnd ? formatDateTime(subscription.currentPeriodEnd) : "—"}</p>
          </div>
        </div>
        ${!subscription.autoRenew ? `<div class="alert alert-warning" style="margin:0"><span>ⓘ</span><span>Auto-renewal is off — access continues until the current period ends, then this subscription will end.</span></div>` : ""}
        <div class="flex gap-3">
          ${isRetryable ? `<button class="btn btn-primary" id="resume-checkout-btn">Resume Payment</button>` : ""}
          ${
            subscription.autoRenew && subscription.status !== "expired"
              ? `<button class="btn btn-secondary" id="cancel-btn">Cancel subscription</button>`
              : ""
          }
        </div>
      </div>
    </div>`;

  const resumeBtn = document.getElementById("resume-checkout-btn");
  if (resumeBtn) resumeBtn.addEventListener("click", resumePayment);

  const cancelBtn = document.getElementById("cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Cancel subscription?",
        message: "This turns off auto-renewal. Your agency keeps access until the current period ends, then the subscription ends.",
        confirmLabel: "Cancel subscription",
        danger: true,
      });
      if (!ok) return;
      try {
        await billingApi.cancelAgencySubscription();
        toastSuccess("Subscription set to not renew.");
        await render(content);
      } catch (err) {
        toastError(err.message);
      }
    });
  }
}

async function main() {
  const user = await requireRole("agency_admin");
  if (!user) return;
  // mountShell() first — see agency-clients.js's comment on this ordering.
  const content = mountShell({ activeKey: "billing", title: "Billing", allowBlocked: true });
  if (!content) return;
  await applyTenantBranding();
  await render(content);
}

main();
