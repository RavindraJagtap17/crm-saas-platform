import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../layouts/PageTitleContext";
import { EmptyState } from "../../components/States";

// Ported from the old frontend's admin-account-inactive.js — Client Admin
// has no billing capability at all, so this is purely explanatory.
export default function AccountInactive() {
  usePageTitle("Account Inactive");
  const { user } = useAuth();

  const agencyBlocked = !!user.tenantStatus && user.tenantStatus !== "active";
  const clientBlocked = !!user.clientStatus && user.clientStatus !== "active";

  const desc = agencyBlocked
    ? "Your agency's account isn't active right now. Please contact your agency administrator."
    : "Your client account has been deactivated by your agency administrator. Contact them to have it reactivated.";

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="card-body">
        <EmptyState icon="⏸" title={clientBlocked && !agencyBlocked ? "This client has been deactivated" : "Your workspace isn't active right now"} desc={desc} />
      </div>
    </div>
  );
}
