import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { emptyState } from "../components/ui.js";

// Step 9 §I: where an employee lands instead of their dashboard while
// their agency's subscription isn't active — they have no billing
// capability at all (that's Tenant Admin's job), so this is purely
// explanatory, not actionable.
async function main() {
  const user = await requireRole("tenant_employee");
  if (!user) return;
  const content = mountShell({ activeKey: null, title: "Account Inactive", allowInactiveTenant: true });

  content.innerHTML = `
    <div class="card" style="max-width:560px">
      <div class="card-body">
        ${emptyState({
          icon: "⏸",
          title: "Your agency's subscription isn't active right now",
          desc: "This can happen while billing is being set up, or if a payment needs attention. Please contact your agency's administrator — they can see and resolve this from the Billing page.",
        })}
      </div>
    </div>
  `;
}

main();
