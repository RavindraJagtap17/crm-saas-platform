import { requireRole, getCurrentUser } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { clientsApi } from "../api/resources.js";
import { renderTable } from "../components/dataTable.js";
import { openModal, confirmDialog } from "../components/modal.js";
import { toast, toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, formatDate, emptyState, setButtonLoading } from "../components/ui.js";

let state = { clients: [], limit: null, licenses: {} };

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let checkoutScriptPromise = null;

// "Agency pays per Client" restructure — a one-off Order against the
// PLATFORM's own Razorpay account (window.CRM_CONFIG.RAZORPAY_KEY_ID, the
// same public key agency-billing.js's own Agency-subscription Checkout
// already uses), never a connected Agency account. Small local helper
// rather than a shared module, matching admin-billing.js/agency-billing.js's
// own established precedent of deliberate small duplication over a
// premature shared abstraction.
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

async function openCheckout({ razorpayKeyId, razorpayOrderId, amount, currency, clientName }, onSettled) {
  try {
    await loadCheckoutScript();
  } catch (err) {
    toastError(err.message);
    return;
  }
  const user = getCurrentUser();
  const razorpay = new window.Razorpay({
    key: razorpayKeyId,
    order_id: razorpayOrderId,
    amount,
    currency,
    name: "Client License",
    description: clientName ? `Client License — ${clientName}` : "Client License",
    prefill: { name: user?.name || "", email: user?.email || "" },
    theme: { color: "#4f46e5" },
    // Browser-perceived success only — never trusted as payment proof;
    // only the webhook (razorpayWebhookService.js) ever activates a license.
    handler: () => onSettled("submitted"),
    modal: { ondismiss: () => onSettled("dismissed") },
  });
  razorpay.open();
}

/**
 * The effective client limit is ALWAYS the number GET /api/clients/limit
 * returns — never recomputed here from a plan's advertised features or
 * any other client-side guess. null = unlimited; 0 can only mean "no
 * active subscription" (a real plan's max_clients is either a positive
 * integer or null — see backend/src/validators/billingValidators.js).
 */
function formatLimitSummary(count, limit) {
  if (limit === 0) return { text: "0 available — no active subscription", over: false, blocked: true };
  if (limit === null) return { text: `${count} client${count === 1 ? "" : "s"} · Unlimited`, over: false, blocked: false };
  const over = count > limit;
  return {
    text: `${count} / ${limit} client${limit === 1 ? "" : "s"}${over ? " — Over plan limit" : ""}`,
    over,
    blocked: count >= limit,
  };
}

function statusBadge(status) {
  return status === "active" ? `<span class="badge badge-success">Active</span>` : `<span class="badge badge-neutral">Inactive</span>`;
}

const LICENSE_STATUS_LABEL = { pending: "Awaiting payment", active: "Active", expired: "Expired" };
const LICENSE_STATUS_BADGE = { pending: "badge-warning", active: "badge-success", expired: "badge-danger" };

function licenseBadgeHtml(license) {
  if (!license) return `<span class="text-tertiary text-sm">—</span>`;
  return `<span class="badge ${LICENSE_STATUS_BADGE[license.status] || "badge-neutral"}">${LICENSE_STATUS_LABEL[license.status] || license.status}</span>`;
}

function columns() {
  return [
    { key: "name", label: "Client", render: (c) => `<span class="table-cell-primary">${escapeHtml(c.name)}</span>` },
    { key: "status", label: "Status", render: (c) => statusBadge(c.status) },
    { key: "license", label: "License", render: (c) => licenseBadgeHtml(state.licenses[c.id]) },
    { key: "created", label: "Created", render: (c) => `<span class="text-secondary text-sm">${formatDate(c.createdAt)}</span>` },
    {
      key: "actions",
      label: "",
      render: (c) => {
        const license = state.licenses[c.id];
        const licenseBtn =
          license && (license.status === "pending" || license.status === "expired")
            ? `<button class="btn btn-secondary btn-sm" data-renew="${c.id}">${license.status === "pending" ? "Resume Payment" : "Renew"}</button>`
            : "";
        const statusBtn =
          c.status === "active"
            ? `<button class="btn btn-ghost btn-sm" data-deactivate="${c.id}">Deactivate</button>`
            : `<button class="btn btn-secondary btn-sm" data-activate="${c.id}">Activate</button>`;
        return `<div class="flex gap-2">${licenseBtn}${statusBtn}</div>`;
      },
    },
  ];
}

async function refresh(content) {
  const tableEl = document.getElementById("clients-table");
  const summaryEl = document.getElementById("limit-summary");
  const addBtn = document.getElementById("add-client-btn");
  renderTable(tableEl, { columns: columns(), rows: null });

  let clients, limit;
  try {
    [{ clients }, { maxClients: limit }] = await Promise.all([clientsApi.list(), clientsApi.limit()]);
  } catch (err) {
    tableEl.innerHTML = emptyState({ icon: "⚠", title: "Couldn't load clients", desc: err.message });
    return;
  }

  const licenseEntries = await Promise.all(
    clients.map((c) => clientsApi.license(c.id).then(({ license }) => [c.id, license]).catch(() => [c.id, null]))
  );
  const licenses = Object.fromEntries(licenseEntries);
  state = { clients, limit, licenses };

  const summary = formatLimitSummary(clients.length, limit);
  summaryEl.innerHTML = `
    <div class="stat-card" style="padding:0">
      <span class="stat-label">Clients</span>
      <span class="stat-value" style="font-size:1.25rem">${escapeHtml(summary.text)}</span>
    </div>
    ${
      summary.over
        ? `<div class="alert alert-warning mt-3"><span>⚠</span><span>You're over your plan's client limit. Existing clients are kept — upgrade your plan or deactivate a client to add another.</span></div>`
        : ""
    }
    ${
      limit === 0
        ? `<div class="alert alert-warning mt-3"><span>⚠</span><span>Subscribe to a plan on the <a href="./billing.html">Billing</a> page before adding clients.</span></div>`
        : ""
    }
  `;

  addBtn.disabled = summary.blocked;
  addBtn.title = summary.blocked ? "You've reached your plan's client limit." : "";

  if (!clients.length) {
    tableEl.innerHTML = emptyState({
      icon: "◎",
      title: "No clients yet",
      desc: "Add your first client to start managing their leads.",
    });
    return;
  }

  renderTable(tableEl, { columns: columns(), rows: clients });

  tableEl.querySelectorAll("[data-deactivate]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Deactivate this client?",
        message: "Its Client Admin and employees will lose access to the CRM until you reactivate it.",
        confirmLabel: "Deactivate",
        danger: true,
      });
      if (!ok) return;
      try {
        await clientsApi.setStatus(btn.dataset.deactivate, "inactive");
        toastSuccess("Client deactivated.");
        refresh(content);
      } catch (err) {
        toastError(err.message);
      }
    })
  );
  tableEl.querySelectorAll("[data-activate]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await clientsApi.setStatus(btn.dataset.activate, "active");
        toastSuccess("Client activated.");
        refresh(content);
      } catch (err) {
        toastError(err.message);
      }
    })
  );
  tableEl.querySelectorAll("[data-renew]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const clientId = e.currentTarget.dataset.renew;
      const client = clients.find((c) => String(c.id) === String(clientId));
      setButtonLoading(e.currentTarget, true);
      try {
        const { checkout } = await clientsApi.renewLicense(clientId);
        if (!checkout) {
          toastError("Could not start the license payment. Try again shortly.");
          return;
        }
        await openCheckout(
          { ...checkout, clientName: client?.name },
          (outcome) => {
            if (outcome === "submitted") toast("Payment submitted. Waiting for payment confirmation.");
            refresh(content);
          }
        );
      } catch (err) {
        toastError(err.message);
      } finally {
        setButtonLoading(e.currentTarget, false);
      }
    })
  );
}

/**
 * §Client creation flow: Clients -> Add Client -> License payment -> Client
 * details -> Invite Client Admin -> Client created. Creating the client,
 * paying for its License, and inviting its first Client Admin are
 * separate steps (mirrors how a Super Admin creates an agency, then
 * separately invites its first Agency Admin) — an "Invite later" skip is
 * offered since the client itself already exists as soon as the first
 * step succeeds, and payment confirmation is asynchronous (webhook-driven)
 * regardless of when the invite happens.
 */
function openInviteAdminStep(content, client) {
  openModal({
    title: `Invite the Client Admin for ${client.name}`,
    bodyHtml: `
      <p class="text-sm text-secondary mb-4">${escapeHtml(client.name)} was created. Invite its first Client Admin now, or skip and do this later.</p>
      <form id="invite-admin-form" novalidate>
        <div class="field">
          <label class="label" for="ia-name">Name</label>
          <input class="input" id="ia-name" placeholder="Jane Doe" />
        </div>
        <div class="field">
          <label class="label" for="ia-email">Email</label>
          <input class="input" type="email" id="ia-email" placeholder="jane@client-company.com" />
          <span class="hint">They'll sign in with this exact Google account.</span>
        </div>
        <div class="field-error" id="ia-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Skip for now</button><button class="btn btn-primary" id="ia-submit">Send invite</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", () => {
        closeFn();
        refresh(content);
      });
      modalEl.querySelector("#ia-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#ia-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        try {
          await clientsApi.inviteAdmin(client.id, {
            name: modalEl.querySelector("#ia-name").value.trim(),
            email: modalEl.querySelector("#ia-email").value.trim(),
            role: "client_admin",
          });
          closeFn();
          toastSuccess("Client Admin invited — they can now sign in with Google using that email.");
          refresh(content);
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

function openCreateClientModal(content) {
  openModal({
    title: "Add client",
    bodyHtml: `
      <form id="client-form" novalidate>
        <div class="field">
          <label class="label" for="c-name">Client name</label>
          <input class="input" id="c-name" placeholder="Acme Retail Co." />
        </div>
        <div class="field">
          <label class="label" for="c-address">Address</label>
          <input class="input" id="c-address" placeholder="221B Baker Street" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="c-city">City</label>
            <input class="input" id="c-city" placeholder="Mumbai" />
          </div>
          <div class="field">
            <label class="label" for="c-gst">GST number</label>
            <input class="input" id="c-gst" placeholder="27ABCDE1234F1Z5" style="text-transform:uppercase" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="label" for="c-mobile">Mobile</label>
            <input class="input" id="c-mobile" placeholder="+919876543210" />
          </div>
          <div class="field">
            <label class="label" for="c-contact-email">Contact email</label>
            <input class="input" type="email" id="c-contact-email" placeholder="contact@acme-retail.com" />
          </div>
        </div>
        <p class="hint">You'll pay for this Client's license right after creating it.</p>
        <div class="field-error" id="c-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="c-submit">Create client</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#c-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#c-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        try {
          const { client, checkout } = await clientsApi.create({
            name: modalEl.querySelector("#c-name").value.trim(),
            address: modalEl.querySelector("#c-address").value.trim(),
            city: modalEl.querySelector("#c-city").value.trim(),
            gstNumber: modalEl.querySelector("#c-gst").value.trim().toUpperCase(),
            mobile: modalEl.querySelector("#c-mobile").value.trim(),
            contactEmail: modalEl.querySelector("#c-contact-email").value.trim(),
          });
          closeFn();
          toastSuccess("Client created.");
          if (checkout) {
            await openCheckout({ ...checkout, clientName: client.name }, (outcome) => {
              if (outcome === "submitted") toast("Payment submitted. Waiting for payment confirmation.");
              openInviteAdminStep(content, client);
            });
          } else {
            toastError("Could not start the license payment — you can retry from the Clients list.");
            openInviteAdminStep(content, client);
          }
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

async function main() {
  const user = await requireRole("agency_admin");
  if (!user) return;
  // mountShell() first: it renders the sidebar's [data-tenant-name]/
  // [data-tenant-logo] placeholders into the DOM, which applyTenantBranding()
  // then fills in — calling it the other way around means those elements
  // don't exist yet and the fetched branding has nothing to attach to.
  const content = mountShell({ activeKey: "clients", title: "Clients" });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Clients</h2>
        <p class="page-subtitle">The businesses your agency manages leads for.</p>
      </div>
      <button class="btn btn-primary" id="add-client-btn">+ Add Client</button>
    </div>
    <div class="card card-pad mb-4" id="limit-summary"></div>
    <div id="clients-table"></div>
  `;

  document.getElementById("add-client-btn").addEventListener("click", () => openCreateClientModal(content));
  await refresh(content);
}

main();
