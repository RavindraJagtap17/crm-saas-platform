import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { emptyState } from "../components/ui.js";

/**
 * Where an Agency Admin lands instead of their console while their own
 * agency is inactive. "Agency pays per Client" restructure: an Agency has
 * no billing capability of its own anymore (Agency signup is free — a
 * suspension is a manual Super Admin action), so, like admin-account-
 * inactive.js for Client Admin/Employee, this is purely explanatory.
 */
async function main() {
  const user = await requireRole("agency_admin");
  if (!user) return;
  const content = mountShell({ activeKey: null, title: "Account Inactive", allowBlocked: true });
  if (!content) return;
  await applyTenantBranding();

  content.innerHTML = `
    <div class="card" style="max-width:560px">
      <div class="card-body">
        ${emptyState({
          icon: "⏸",
          title: "Your workspace isn't active right now",
          desc: "Your agency's account isn't active right now. Contact the platform administrator.",
        })}
      </div>
    </div>
  `;
}

main();
