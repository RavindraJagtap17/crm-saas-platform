import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../layouts/PageTitleContext";
import { EmptyState } from "../../components/States";

// Ported from the old frontend's employee-account-inactive.js.
export default function AccountInactive() {
  usePageTitle("Account Inactive");
  const { user } = useAuth();
  const agencyBlocked = !!user.tenantStatus && user.tenantStatus !== "active";
  const desc = agencyBlocked
    ? "This can happen while billing is being set up, or if a payment needs attention. Please contact your agency's administrator — they can see and resolve this from the Billing page."
    : "Your client account has been deactivated. Please contact your Client Admin or agency administrator.";

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="card-body">
        <EmptyState icon="⏸" title="Your workspace isn't active right now" desc={desc} />
      </div>
    </div>
  );
}
