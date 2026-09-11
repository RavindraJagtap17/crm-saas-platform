import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { superAdminApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { AccountStatusBadge } from "../../components/Badges";
import { EmptyState, SkeletonRows, SkeletonStatCards, ErrorState } from "../../components/States";
import { toastSuccess } from "../../components/toast";
import { formatDate } from "../../utils/format";

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "pending_payment", label: "Pending payment" },
  { value: "canceled", label: "Canceled" },
];

function CreateAgencyModal({ open, onClose }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const { tenant } = await superAdminApi.createAgency(name.trim());
      toastSuccess("Agency created.");
      navigate(`/super-admin/tenant/${tenant.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create agency"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>Create agency</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="ag-name">Agency name</label>
          <input className="input" id="ag-name" placeholder="Acme Leads Co." value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error ? <div className="field-error">{error}</div> : null}
        <p className="hint">This only creates the agency. Invite its first Agency Admin from the agency's detail page next.</p>
      </form>
    </Modal>
  );
}

export default function Overview() {
  usePageTitle("Platform Overview");
  const navigate = useNavigate();
  const [overview, setOverview] = useState(undefined);
  const [overviewError, setOverviewError] = useState(null);
  const [tenants, setTenants] = useState(null);
  const [tenantsError, setTenantsError] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const debounceRef = useRef(null);

  const fetchTenants = async (query, statusVal) => {
    setTenants(null);
    setTenantsError(null);
    try {
      const { tenants: t } = await superAdminApi.listTenants({ q: query.trim() || undefined, status: statusVal || undefined });
      setTenants(t);
    } catch (err) {
      setTenantsError(err.message);
    }
  };

  const loadOverview = async () => {
    setOverview(undefined);
    setOverviewError(null);
    try {
      const data = await superAdminApi.overview();
      setOverview(data);
    } catch (err) {
      setOverviewError(err.message);
    }
  };

  useEffect(() => {
    loadOverview();
    fetchTenants("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-side search/filter (§2) — every keystroke/selection re-fetches
  // GET /api/super-admin/tenants?q=&status= rather than filtering a
  // client-held list, so the list stays correct as agencies are added and
  // never over-fetches. Debounced on the text input only; the status
  // dropdown re-fetches immediately on change.
  const onQChange = (value) => {
    setQ(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchTenants(value, status), 300);
  };

  const onStatusChange = (value) => {
    setStatus(value);
    fetchTenants(q, value);
  };

  if (overviewError) {
    return <ErrorState desc={overviewError} onRetry={() => window.location.reload()} />;
  }

  return (
    <>
      {overview === undefined ? (
        <SkeletonStatCards count={8} />
      ) : (
        <div className="grid-stats mb-6">
          <div className="card stat-card">
            <span className="stat-label">Total Agencies</span>
            <span className="stat-value">{overview.totalTenants}</span>
            <span className="stat-meta">{Object.entries(overview.tenantsByStatus).map(([s, c]) => `${c} ${s.replace("_", " ")}`).join(" · ") || "—"}</span>
          </div>
          <div className="card stat-card">
            <span className="stat-label">Total Clients</span>
            <span className="stat-value">{overview.totalClients}</span>
            <span className="stat-meta">{overview.activeClients} active</span>
          </div>
          <div className="card stat-card"><span className="stat-label">Total Users</span><span className="stat-value">{overview.totalUsers}</span></div>
          <div className="card stat-card"><span className="stat-label">Total Leads</span><span className="stat-value">{overview.totalLeads}</span></div>
          <div className="card stat-card"><span className="stat-label">Active Licenses</span><span className="stat-value">{overview.clientLicenses.active}</span></div>
          <div className="card stat-card">
            <span className="stat-label">Expiring Soon</span>
            <span className="stat-value">{overview.clientLicenses.expiringSoon}</span>
            <span className="stat-meta">Within 30 days</span>
          </div>
          <div className="card stat-card"><span className="stat-label">Expired Licenses</span><span className="stat-value">{overview.clientLicenses.expired}</span></div>
          <div className="card stat-card"><span className="stat-label">Pending Licenses</span><span className="stat-value">{overview.clientLicenses.pending}</span></div>
        </div>
      )}

      {overview?.recentAgencies?.length ? (
        <div className="card mb-6">
          <div className="card-header"><h2 className="card-title">Recent Agencies</h2></div>
          <div className="card-body" style={{ padding: 0 }}>
            <ul className="flex-col">
              {overview.recentAgencies.map((t) => (
                <li key={t.id}>
                  <a
                    href={`/super-admin/tenant/${t.id}`}
                    onClick={(e) => { e.preventDefault(); navigate(`/super-admin/tenant/${t.id}`); }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-3) var(--space-4)", textDecoration: "none", borderBottom: "1px solid var(--border-subtle)" }}
                  >
                    <span>
                      <span className="table-cell-primary">{t.name}</span> <span className="text-tertiary text-xs">{formatDate(t.createdAt)}</span>
                    </span>
                    <AccountStatusBadge status={t.status} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Agencies</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>+ New Agency</button>
        </div>
        <div className="card-body flex-row gap-3" style={{ flexWrap: "wrap", paddingBottom: 0 }}>
          <input className="input" placeholder="Search by name, email, mobile, or GST…" style={{ flex: 1, minWidth: 220 }} value={q} onChange={(e) => onQChange(e.target.value)} />
          <select className="select" style={{ width: "auto" }} value={status} onChange={(e) => onStatusChange(e.target.value)}>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {tenantsError ? (
          <div className="card-body"><EmptyState icon="⚠" title="Couldn't load agencies" desc={tenantsError} /></div>
        ) : tenants === null ? (
          <div className="card-body"><SkeletonRows count={3} /></div>
        ) : !tenants.length ? (
          <div className="card-body"><EmptyState icon="◆" title="No agencies match" desc="Try a different search or filter." /></div>
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead><tr><th>Agency</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="is-clickable" onClick={() => navigate(`/super-admin/tenant/${t.id}`)}>
                    <td data-label="Agency">
                      <span className="table-cell-primary">{t.name}</span>
                      <div className="table-cell-muted text-xs">{t.slug}</div>
                    </td>
                    <td data-label="Status"><AccountStatusBadge status={t.status} /></td>
                    <td data-label="Created" className="text-secondary text-sm">{formatDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateAgencyModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
