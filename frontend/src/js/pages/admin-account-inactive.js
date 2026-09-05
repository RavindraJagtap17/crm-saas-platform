import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { emptyState } from "../components/ui.js";

/**
 * Where a Client Admin lands instead of their dashboard while either
 * their own client OR their agency is inactive. Client Admin has NO
 * billing capability at all (that's the Agency Admin's job) — so, unlike
 * the old tenant_admin flow that redirected to its own billing page,
 * this is purely explanatory, not actionable. The specific cause (client
 * vs. agency) is distinguished so the message points them at the right
 * person to contact.
 */
async function main() {
  const user = await requireRole("client_admin");
  if (!user) return;
  const content = mountShell({ activeKey: null, title: "Account Inactive", allowBlocked: true });
  if (!content) return;
  await applyTenantBranding();

  const agencyBlocked = !!user.tenantStatus && user.tenantStatus !== "active";
  const clientBlocked = !!user.clientStatus && user.clientStatus !== "active";

  const desc = agencyBlocked
    ? "Your agency's subscription isn't active right now. Please contact your agency administrator — they can see and resolve this from their Billing page."
    : "Your client account has been deactivated by your agency administrator. Contact them to have it reactivated.";

  content.innerHTML = `
    <div class="card" style="max-width:560px">
      <div class="card-body">
        ${emptyState({
          icon: "⏸",
          title: clientBlocked && !agencyBlocked ? "This client has been deactivated" : "Your workspace isn't active right now",
          desc,
        })}
      </div>
    </div>
  `;
}

main();
