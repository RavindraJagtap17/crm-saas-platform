import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { superAdminApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { confirmDialog } from "../../components/confirmDialog";
import { toastSuccess, toastError } from "../../components/toast";
import { AccountStatusBadge, LicenseStatusBadge } from "../../components/Badges";
import { EmptyState, SkeletonRows } from "../../components/States";
import { formatDate, formatDaysRemaining } from "../../utils/format";

// "Agency pays per Client" restructure: Agency signup is free and a fresh
// tenant now starts 'active' (see tenantModel.createTenant) — there is no
// subscription/payment concept left at the Agency level at all, so this is
// the ONLY lever Super Admin has over an agency's account status. Directly
// flips tenants.status via superAdminService.updateStatus.
// 'pending_payment' is kept only for any tenant already in that state from
// before this restructure shipped (the ENUM value itself is never removed —
// see tenantModel.createTenant's own comment).
const STATUS_ACTIONS = {
  pending_payment: [{ to: "active", label: "Activate", danger: false }],
  active: [{ to: "suspended", label: "Suspend", danger: true }],
  suspended: [
    { to: "active", label: "Reactivate", danger: false },
    { to: "canceled", label: "Cancel", danger: true },
  ],
  canceled: [{ to: "active", label: "Reactivate", danger: false }],
};

const LICENSE_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "EXPIRING_SOON", label: "Expiring Soon" },
  { value: "EXPIRED", label: "Expired" },
  { value: "PENDING", label: "Pending" },
];

function InviteAgencyAdminModal({ open, tenantId, onClose, onInvited }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await superAdminApi.inviteAgencyAdmin(tenantId, { name: name.trim(), email: email.trim(), role: "agency_admin" });
      toastSuccess("Agency Admin invited.");
      onInvited();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Invite Agency Admin"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>Send invite</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <p className="hint mb-4">Add another Agency Admin to this Agency, or provision the first admin for a manually created Agency.</p>
        <div className="field">
          <label className="label" htmlFor="ia-name">Name</label>
          <input className="input" id="ia-name" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="ia-email">Email</label>
          <input className="input" type="email" id="ia-email" placeholder="jane@agency.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="hint">They'll sign in with this exact Google account.</span>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

function BusinessInfo({ tenant }) {
  const row = (label, value) => (
    <div>
      <span className="label">{label}</span>
      <div className="mt-2">{value || "—"}</div>
    </div>
  );
  return (
    <>
      <div className="field-row mb-4">
        {row("Address", tenant.address)}
        {row("City", tenant.city)}
      </div>
      <div className="field-row">
        {row("GST Number", tenant.gstNumber)}
        {row("Mobile", tenant.mobile)}
      </div>
      <div className="field-row mt-4">
        {row("Contact Email", tenant.contactEmail)}
        {row("Created", formatDate(tenant.createdAt))}
      </div>
    </>
  );
}

function ClientsTable({ clients, clientCount, tenantId }) {
  const navigate = useNavigate();
  const [licenseFilter, setLicenseFilter] = useState("");
  const filtered = licenseFilter ? clients.filter((c) => c.license.status === licenseFilter) : clients;

  if (!clients.length) {
    return <div className="card-body"><EmptyState title="No clients yet" desc="The Agency Admin adds clients from their own Clients page." /></div>;
  }

  return (
    <>
      <div className="card-header">
        <h3 className="card-title">Clients ({clientCount})</h3>
        <select className="select" style={{ width: "auto" }} value={licenseFilter} onChange={(e) => setLicenseFilter(e.target.value)}>
          {LICENSE_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
        {!filtered.length ? (
          <div className="card-body"><EmptyState title="No clients match this filter" /></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Client</th><th>Status</th><th>License</th><th>Expiry</th><th>Days Remaining</th></tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="is-clickable"
                  tabIndex={0}
                  role="button"
                  onClick={() => navigate(`/super-admin/client/${tenantId}/${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/super-admin/client/${tenantId}/${c.id}`);
                    }
                  }}
                >
                  <td data-label="Client" className="table-cell-primary">{c.name}</td>
                  <td data-label="Status">{c.status === "active" ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
                  <td data-label="License"><LicenseStatusBadge status={c.license.status} /></td>
                  <td data-label="Expiry" className="text-secondary text-sm">{c.license.expiresAt ? formatDate(c.license.expiresAt) : "—"}</td>
                  <td data-label="Days Remaining" className="text-secondary text-sm">{formatDaysRemaining(c.license.daysRemaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function Tenant() {
  usePageTitle("Agency");
  const { id: tenantId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const refresh = async () => {
    setData(undefined);
    setError(null);
    try {
      const d = await superAdminApi.getTenant(tenantId);
      setData(d);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const changeStatus = async (to, label, danger) => {
    const ok = await confirmDialog({
      title: `${label} this agency?`,
      message: `This changes ${data.tenant.name}'s status to "${to}", which affects whether their clients can use the workspace.`,
      confirmLabel: label,
      danger,
    });
    if (!ok) return;
    setStatusBusy(true);
    try {
      await superAdminApi.updateStatus(tenantId, to);
      toastSuccess(`Agency status set to ${to}.`);
      await refresh();
    } catch (err) {
      toastError(err.message);
    } finally {
      setStatusBusy(false);
    }
  };

  if (error) {
    return <EmptyState icon="⚠" title="Couldn't load this agency" desc={error} />;
  }

  if (data === undefined) {
    return <SkeletonRows count={4} />;
  }

  const { tenant, clientCount, clients, users } = data;

  return (
    <>
      <a href="/super-admin" className="text-sm" onClick={(e) => { e.preventDefault(); navigate("/super-admin"); }}>← All agencies</a>
      <div className="page-header mt-2">
        <div>
          <h2 className="page-title">{tenant.name}</h2>
          <p className="page-subtitle">{tenant.slug}</p>
        </div>
        <AccountStatusBadge status={tenant.status} />
      </div>

      <div className="card mb-6">
        <div className="card-header"><h3 className="card-title">Business Information</h3></div>
        <div className="card-body"><BusinessInfo tenant={tenant} /></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)" }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Agency Admins ({users.length})</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setInviteOpen(true)}>+ Invite Agency Admin</button>
          </div>
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            {users.length ? (
              <table className="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td data-label="Name" className="table-cell-primary">{u.name}</td>
                      <td data-label="Email" className="table-cell-muted">{u.email}</td>
                      <td data-label="Status"><AccountStatusBadge status={u.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="card-body"><EmptyState title="No Agency Admin invited yet" /></div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="card-title">Account Status</h3></div>
          <div className="card-body">
            <p className="text-sm mb-4">Agency signup is free — this is a manual override of the agency's account status.</p>
            <div className="flex gap-2">
              {(STATUS_ACTIONS[tenant.status] || []).map((a) => (
                <LoadingButton
                  key={a.to}
                  className={`btn ${a.danger ? "btn-danger" : "btn-primary"}`}
                  loading={statusBusy}
                  onClick={() => changeStatus(a.to, a.label, a.danger)}
                >
                  {a.label}
                </LoadingButton>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-6">
        <ClientsTable clients={clients} clientCount={clientCount} tenantId={tenantId} />
      </div>

      <InviteAgencyAdminModal open={inviteOpen} tenantId={tenantId} onClose={() => setInviteOpen(false)} onInvited={async () => { setInviteOpen(false); await refresh(); }} />
    </>
  );
}
