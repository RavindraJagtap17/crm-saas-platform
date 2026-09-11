import { usePageTitle } from "../../layouts/PageTitleContext";
import { EmptyState } from "../../components/States";

// Ported from the old frontend's agency-account-inactive.js — an Agency
// has no billing capability of its own (Agency signup is free — a
// suspension is a manual Super Admin action), so this is purely explanatory.
export default function AccountInactive() {
  usePageTitle("Account Inactive");
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="card-body">
        <EmptyState icon="⏸" title="Your workspace isn't active right now" desc="Your agency's account isn't active right now. Contact the platform administrator." />
      </div>
    </div>
  );
}
