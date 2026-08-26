import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { tenantApi } from "../api/resources.js";
import { accountStatusBadge } from "../components/ui.js";

async function main() {
  const user = await requireRole("tenant_admin");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "billing", title: "Billing" });

  const { tenant } = await tenantApi.get();

  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Billing</h2><p class="page-subtitle">Your subscription status.</p></div>
    </div>
    <div class="card" style="max-width:560px">
      <div class="card-body">
        <div class="flex items-center justify-between mb-4">
          <span class="label">Account status</span>
          ${accountStatusBadge(tenant.status)}
        </div>
        <div class="flex items-center justify-between">
          <span class="label">Employee limit</span>
          <span class="num font-semibold">${tenant.employeeLimit}</span>
        </div>
      </div>
      <div class="card-footer" style="justify-content:flex-start">
        <div class="alert alert-info" style="width:100%">
          <span>ℹ</span>
          <span>Subscription plans and payment are handled by Razorpay in a later phase. Your account status above is
          managed by your platform administrator until then.</span>
        </div>
      </div>
    </div>
  `;
}

main();
