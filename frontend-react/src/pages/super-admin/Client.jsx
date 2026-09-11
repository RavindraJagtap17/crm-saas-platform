import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { superAdminApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import { AccountStatusBadge, LicenseStatusBadge } from "../../components/Badges";
import { EmptyState, SkeletonRows } from "../../components/States";
import { formatDate, formatDaysRemaining } from "../../utils/format";

export default function Client() {
  usePageTitle("Client");
  const { tenantId, clientId } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      setClient(undefined);
      setError(null);
      try {
        const c = await superAdminApi.getClient(tenantId, clientId);
        setClient(c);
      } catch (err) {
        setError(err.status === 404 ? "This client doesn't exist under that Agency." : err.message);
      }
    })();
  }, [tenantId, clientId]);

  if (error) {
    return <EmptyState icon="⚠" title="Couldn't load this client" desc={error} />;
  }

  if (client === undefined) {
    return <SkeletonRows count={4} />;
  }

  return (
    <>
      <a
        href={`/super-admin/tenant/${client.tenantId}`}
        className="text-sm"
        onClick={(e) => { e.preventDefault(); navigate(`/super-admin/tenant/${client.tenantId}`); }}
      >
        ← {client.tenantName}
      </a>
      <div className="page-header mt-2">
        <div>
          <h2 className="page-title">{client.name}</h2>
          <p className="page-subtitle">Client of {client.tenantName}</p>
        </div>
        <AccountStatusBadge status={client.status} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)" }}>
        <div className="card">
          <div className="card-header"><h3 className="card-title">Business Information</h3></div>
          <div className="card-body">
            <div className="field-row mb-4">
              <div><span className="label">Address</span><div className="mt-2">{client.address || "—"}</div></div>
              <div><span className="label">City</span><div className="mt-2">{client.city || "—"}</div></div>
            </div>
            <div className="field-row mb-4">
              <div><span className="label">GST Number</span><div className="mt-2">{client.gstNumber || "—"}</div></div>
              <div><span className="label">Mobile</span><div className="mt-2">{client.mobile || "—"}</div></div>
            </div>
            <div className="field-row">
              <div><span className="label">Contact Email</span><div className="mt-2">{client.contactEmail || "—"}</div></div>
              <div><span className="label">Created</span><div className="mt-2">{formatDate(client.createdAt)}</div></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="card-title">License</h3></div>
          <div className="card-body">
            <div className="field-row mb-4">
              <div><span className="label">Status</span><div className="mt-2"><LicenseStatusBadge status={client.license.status} /></div></div>
              <div><span className="label">Days Remaining</span><div className="mt-2">{formatDaysRemaining(client.license.daysRemaining)}</div></div>
            </div>
            <div className="field-row mb-4">
              <div><span className="label">Expires</span><div className="mt-2">{client.license.expiresAt ? formatDate(client.license.expiresAt) : "—"}</div></div>
            </div>
            <div className="divider" />
            <p className="text-xs text-tertiary mb-2">Current cycle only — not a payment history.</p>
            <div className="field-row">
              <div><span className="label">Razorpay Order</span><div className="mt-2 text-sm">{client.license.razorpayOrderId || "—"}</div></div>
              <div><span className="label">Razorpay Payment</span><div className="mt-2 text-sm">{client.license.razorpayPaymentId || "—"}</div></div>
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-6">
        <div className="card-header"><h3 className="card-title">Client Admins ({client.admins.length})</h3></div>
        <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
          {client.admins.length ? (
            <table className="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
              <tbody>
                {client.admins.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Name" className="table-cell-primary">{a.name}</td>
                    <td data-label="Email" className="table-cell-muted">{a.email}</td>
                    <td data-label="Status"><AccountStatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="card-body"><EmptyState title="No Client Admin invited yet" /></div>
          )}
        </div>
      </div>

      <div className="card mt-6 stat-card" style={{ maxWidth: 280 }}>
        <span className="stat-label">Client Employees</span>
        <span className="stat-value">{client.employeeCount}</span>
      </div>
    </>
  );
}
