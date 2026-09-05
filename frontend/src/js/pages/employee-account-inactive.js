import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { emptyState } from "../components/ui.js";

/**
 * Where a Client Employee lands instead of their dashboard while either
 * their client OR their agency is inactive — they have no billing
 * capability at all (that's the Agency Admin's job, two levels up), so
 * this is purely explanatory, not actionable.
 */
async function main() {
  const user = await requireRole("client_employee");
  if (!user) return;
  const content = mountShell({ activeKey: null, title: "Account Inactive", allowBlocked: true });
  if (!content) return;
  await applyTenantBranding();

  const agencyBlocked = !!user.tenantStatus && user.tenantStatus !== "active";

  const desc = agencyBlocked
    ? "This can happen while billing is being set up, or if a payment needs attention. Please contact your agency's administrator — they can see and resolve this from the Billing page."
    : "Your client account has been deactivated. Please contact your Client Admin or agency administrator.";

  content.innerHTML = `
    <div class="card" style="max-width:560px">
      <div class="card-body">
        ${emptyState({
          icon: "⏸",
          title: "Your workspace isn't active right now",
          desc,
        })}
      </div>
    </div>
  `;
}

main();
