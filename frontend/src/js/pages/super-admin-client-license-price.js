import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { superAdminApi } from "../api/resources.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading } from "../components/ui.js";

/**
 * New business model: the ONE price an Agency pays the Platform per
 * Client it adds, valid for exactly one year (client_license_price,
 * migration 055) — set via GET/PUT /api/super-admin/client-license-price.
 * Mirrors super-admin-plans.js's own single-price-editor pattern exactly,
 * but simpler: no Razorpay Plan ID (Client licenses are paid via one-off
 * Orders against the platform's own Razorpay account, not a recurring
 * Subscription — see the "Agency pays per Client" restructure plan), no
 * Active/Inactive toggle (there's nothing to deactivate — this price
 * always applies), no billing cycle (fixed at one year by business rule).
 */
function priceFormHtml(price) {
  return `
    <form id="clp-form" novalidate>
      <div class="field-row">
        <div class="field">
          <label class="label" for="clp-price">Price</label>
          <input class="input" type="number" min="0" step="0.01" id="clp-price" value="${price ? (price.price / 100).toFixed(2) : ""}" placeholder="4999.00" />
          <span class="hint">Charged to the Agency each time they add a Client, and again each year at renewal.</span>
        </div>
        <div class="field">
          <label class="label" for="clp-currency">Currency</label>
          <input class="input" id="clp-currency" value="${escapeHtml(price?.currency || "INR")}" maxlength="3" style="text-transform:uppercase" />
        </div>
      </div>
      <div class="field">
        <span class="label">License term</span>
        <p class="text-sm text-secondary">One year — fixed by the business model, not configurable here.</p>
      </div>
      <div class="field-error" id="clp-error" hidden></div>
    </form>`;
}

async function refresh(container) {
  container.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  let price;
  try {
    ({ price } = await superAdminApi.getClientLicensePrice());
  } catch (err) {
    container.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load the Client license price", desc: err.message })}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="card" style="max-width:560px">
      ${
        !price
          ? `<div class="card-body">${emptyState({
              icon: "$",
              title: "No Client license price set up yet",
              desc: "Set a price before any Agency can add a Client.",
            })}</div>`
          : ""
      }
      <div class="card-body">${priceFormHtml(price)}</div>
      <div class="card-footer">
        <button class="btn btn-primary" id="clp-save">${price ? "Save changes" : "Set up price"}</button>
      </div>
    </div>`;

  document.getElementById("clp-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById("clp-error");
    errEl.hidden = true;
    setButtonLoading(btn, true);

    const priceInput = Number(document.getElementById("clp-price").value);
    const body = {
      price: Math.round(priceInput * 100), // smallest currency unit, matching every other price field in this app
      currency: document.getElementById("clp-currency").value.trim().toUpperCase(),
    };

    try {
      await superAdminApi.upsertClientLicensePrice(body);
      toastSuccess(price ? "Client license price updated." : "Client license price set up.");
      await refresh(container);
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
      toastError("Couldn't save the Client license price.");
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

async function main() {
  const user = await requireRole("super_admin");
  if (!user) return;
  const content = mountShell({ activeKey: "client-license-price", title: "Client License Price" });
  if (!content) return;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Client License Price</h2>
        <p class="page-subtitle">What every Agency pays per Client, per year.</p>
      </div>
    </div>
    <div id="price-card"></div>
  `;
  await refresh(document.getElementById("price-card"));
}

main();
