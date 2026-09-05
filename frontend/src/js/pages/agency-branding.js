import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { tenantApi } from "../api/resources.js";
import { toastSuccess, toastError } from "../components/toast.js";
import { escapeHtml, setButtonLoading } from "../components/ui.js";

async function main() {
  const user = await requireRole("agency_admin");
  if (!user) return;
  // mountShell() first — see agency-clients.js's comment on this ordering.
  const content = mountShell({ activeKey: "branding", title: "Branding" });
  if (!content) return;
  const tenant = await applyTenantBranding();

  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Branding</h2><p class="page-subtitle">How your agency looks across every client workspace — name, logo, and brand color.</p></div>
    </div>
    <div class="card" style="max-width:560px">
      <div class="card-body">
        <form id="branding-form" novalidate>
          <div class="field">
            <label class="label" for="b-name">Agency name</label>
            <input class="input" id="b-name" value="${escapeHtml(tenant?.name || "")}" />
          </div>
          <div class="field">
            <label class="label" for="b-logo">Logo URL <span class="optional">(optional)</span></label>
            <input class="input" id="b-logo" value="${escapeHtml(tenant?.logoUrl || "")}" placeholder="https://…/logo.png" />
            <span class="hint">A hosted image URL — file upload isn't part of Phase 1.</span>
          </div>
          <div class="field">
            <label class="label" for="b-color">Brand color</label>
            <div class="flex items-center gap-3">
              <input class="input" type="color" id="b-color" value="${tenant?.brandPrimaryColor || "#4f46e5"}" style="height:40px;width:64px;padding:4px" />
              <span class="text-sm text-secondary num" id="b-color-value">${tenant?.brandPrimaryColor || "#4f46e5"}</span>
            </div>
            <span class="hint">Used for buttons, links, and highlights throughout your agency's and every client's workspace.</span>
          </div>
          <div class="field-error" id="b-error" hidden></div>
        </form>
      </div>
      <div class="card-footer">
        <button class="btn btn-primary" id="b-save">Save branding</button>
      </div>
    </div>
  `;

  const colorInput = document.getElementById("b-color");
  colorInput.addEventListener("input", (e) => {
    document.getElementById("b-color-value").textContent = e.target.value;
    document.documentElement.style.setProperty("--brand-500", e.target.value);
  });

  document.getElementById("b-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById("b-error");
    errEl.hidden = true;
    setButtonLoading(btn, true);
    try {
      await tenantApi.update({
        name: document.getElementById("b-name").value.trim(),
        logoUrl: document.getElementById("b-logo").value.trim() || null,
        brandPrimaryColor: colorInput.value,
      });
      toastSuccess("Branding updated.");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message;
      toastError("Couldn't save branding.");
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

main();
