import { useEffect, useRef, useState } from "react";
import { superAdminApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import DataTable from "../../components/DataTable";
import Pagination from "../../components/Pagination";
import { confirmDialog } from "../../components/confirmDialog";
import { toast, toastSuccess, toastError } from "../../components/toast";
import { ErrorState, SkeletonStatCards } from "../../components/States";
import { formatDateTime } from "../../utils/format";

// Same fixed set every provider-facing page in this app already uses —
// not auto-discovered (there is no "list every provider that has ever
// been seen" endpoint, and inventing one isn't warranted for a 4-item
// filter dropdown).
const PROVIDERS = [
  { value: "", label: "All providers" },
  { value: "meta", label: "Meta" },
  { value: "google", label: "Google Ads" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "indiamart", label: "IndiaMART" },
];

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "received", label: "Received" },
  { value: "processing", label: "Processing" },
  { value: "processed", label: "Processed" },
  { value: "duplicate", label: "Duplicate" },
  { value: "failed", label: "Failed" },
];

const STATUS_BADGE = { received: "badge-neutral", processing: "badge-neutral", processed: "badge-success", duplicate: "badge-neutral", failed: "badge-danger" };
const STATUS_LABEL = { received: "Received", processing: "Processing", processed: "Processed", duplicate: "Duplicate", failed: "Failed" };
const RETRY_RESULT_BADGE = { SUCCESS: "badge-success", FAILED: "badge-danger", REJECTED: "badge-neutral", IN_PROGRESS: "badge-warning" };

function Metrics({ summary }) {
  const cards = [
    { label: "Total Events", value: summary.total },
    { label: "Failed", value: summary.failed },
    { label: "Processing", value: summary.processing },
    { label: "Received", value: summary.received },
    { label: "Duplicate", value: summary.duplicate },
    { label: "Processed", value: summary.processed },
    { label: "Recovered", value: summary.recovered, meta: "subset of Received" },
    { label: "Retry Pending", value: summary.retryPending, meta: "subset of Failed" },
  ];
  return (
    <div className="grid-stats mb-6">
      {cards.map((c) => (
        <div key={c.label} className="card stat-card">
          <span className="stat-label">{c.label}</span>
          <span className="stat-value">{c.value}</span>
          {c.meta ? <span className="stat-meta">{c.meta}</span> : null}
        </div>
      ))}
    </div>
  );
}

function eventColumns() {
  return [
    {
      key: "agencyClient",
      label: "Agency / Client",
      render: (ev) => (
        <>
          <div className="table-cell-primary">{ev.tenantName ? ev.tenantName : <span className="text-tertiary">Unknown agency</span>}</div>
          <div className="table-cell-muted text-xs">{ev.clientName ? ev.clientName : ev.clientId ? `#${ev.clientId}` : "—"}</div>
        </>
      ),
    },
    { key: "provider", label: "Provider", render: (ev) => <span className="badge badge-neutral">{ev.providerLabel}</span> },
    {
      key: "event",
      label: "Event",
      render: (ev) => (
        <>
          <div className="table-cell-primary">#{ev.id}</div>
          <div className="table-cell-muted text-xs" title={ev.externalLeadId}>
            {ev.externalLeadId.length > 36 ? `${ev.externalLeadId.slice(0, 36)}…` : ev.externalLeadId}
          </div>
        </>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (ev) => (
        <>
          <span className={`badge ${STATUS_BADGE[ev.status] || "badge-neutral"}`}>{STATUS_LABEL[ev.status] || ev.status}</span>
          {ev.recovered ? <span className="badge badge-warning" title="Reset back to 'received' after getting stuck in 'processing'"> Recovered</span> : null}
          <div className="table-cell-muted text-xs">{ev.summary}</div>
          {ev.status === "failed" && ev.nextAttemptAt ? <div className="text-tertiary text-xs">Next retry: {formatDateTime(ev.nextAttemptAt)}</div> : null}
        </>
      ),
    },
    { key: "attempts", label: "Attempts", render: (ev) => ev.attempts },
    {
      key: "crmLead",
      label: "CRM Lead",
      render: (ev) =>
        ev.crmLeadId ? (
          <a href={`/admin/leads/${ev.crmLeadId}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            #{ev.crmLeadId}
          </a>
        ) : (
          "—"
        ),
    },
    { key: "created", label: "Created", render: (ev) => <span className="text-secondary text-sm">{formatDateTime(ev.receivedAt)}</span> },
    { key: "updated", label: "Updated", render: (ev) => <span className="text-secondary text-sm">{formatDateTime(ev.updatedAt)}</span> },
  ];
}

function Attribution({ attribution }) {
  if (!attribution || typeof attribution !== "object" || !Object.keys(attribution).length) {
    return <p className="text-tertiary text-sm">None recorded.</p>;
  }
  return (
    <table className="data-table">
      <tbody>
        {Object.entries(attribution).map(([k, v]) => (
          <tr key={k}>
            <td className="table-cell-primary" style={{ width: "40%" }}>{k}</td>
            <td>{v === null || v === undefined ? "—" : String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Display-only convenience — matches integrationMonitoringService.
// classifyRetryEligibility's own rule set exactly, but this is NOT the
// security boundary: it only decides whether to SHOW the button. The
// server re-derives eligibility from the persisted row independently on
// every retry attempt, so a stale or tampered client-side read here can
// only ever produce a REJECTED/IN_PROGRESS response, never an unsafe retry.
function isRetryEligible(ev) {
  if (ev.provider === "meta") return false;
  if (ev.status === "processed" || ev.status === "duplicate") return false;
  if (ev.status === "processing") return false;
  if (ev.status === "failed" && !ev.nextAttemptAt) return false;
  return ev.status === "failed" || ev.status === "received";
}

// "Retry History" — manual Super Admin retry attempts only (every row this
// reads was written by the retry button's own POST .../retry, via
// integrationMonitoringService.retryEvent's auditRetryAttempt — scheduler/
// backoff retries never write to audit_logs at all, so nothing here needs
// its own manual-vs-automatic flag to avoid mislabeling one as the other).
function RetryHistory({ items }) {
  if (!items.length) return <p className="text-tertiary text-sm">No manual retry attempts for this event.</p>;
  return (
    <>
      {items.map((h, i) => (
        <div key={i} className="py-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            <span className="text-sm text-secondary">{formatDateTime(h.createdAt)}</span>
            <span className={`badge ${RETRY_RESULT_BADGE[h.result] || "badge-neutral"}`}>{h.result}</span>
            {h.attempts != null ? <span className="text-tertiary text-xs">Attempt {h.attempts}</span> : null}
          </div>
          <div className="text-sm">
            {h.initiatedBy}
            {h.actorRole ? <span className="text-tertiary text-xs"> ({h.actorRole.replace(/_/g, " ")})</span> : null}
          </div>
          {h.previousStatus || h.newStatus ? (
            <div className="text-tertiary text-xs">
              {h.previousStatus ? STATUS_LABEL[h.previousStatus] || h.previousStatus : "—"} → {h.newStatus ? STATUS_LABEL[h.newStatus] || h.newStatus : "—"}
            </div>
          ) : null}
          {h.message ? <div className="text-sm">{h.message}</div> : null}
        </div>
      ))}
    </>
  );
}

function EventDetailModal({ open, eventId, onClose, onChanged }) {
  const [ev, setEv] = useState(undefined);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const load = async () => {
    setEv(undefined);
    setError(null);
    try {
      const [e, h] = await Promise.all([superAdminApi.getIntegrationEvent(eventId), superAdminApi.getRetryHistory(eventId)]);
      setEv(e);
      setHistory(h.items);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (open && eventId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  if (!open) return null;

  const retry = async () => {
    const ok = await confirmDialog({
      title: "Retry this integration event now?",
      message: `Provider: ${ev.providerLabel}\nClient: ${ev.clientName ? ev.clientName : ev.clientId ? `#${ev.clientId}` : "Unknown"}\nEvent: #${ev.id}\nCurrent status: ${STATUS_LABEL[ev.status] || ev.status}\nAttempts so far: ${ev.attempts}`,
      confirmLabel: "Retry Now",
    });
    if (!ok) return;
    setRetrying(true);
    try {
      const { result, message } = await superAdminApi.retryIntegrationEvent(ev.id);
      if (result === "SUCCESS") toastSuccess(message);
      else if (result === "FAILED") toastError(message);
      else toast(message, { type: "info" }); // IN_PROGRESS / REJECTED
    } catch (err) {
      toastError(err.message);
    } finally {
      setRetrying(false);
      await load();
      onChanged();
    }
  };

  return (
    <Modal open={open} title={ev ? `Event #${ev.id}` : "Event"} onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      {error ? (
        <ErrorState desc={error} />
      ) : ev === undefined ? (
        <div className="skeleton skeleton-row" />
      ) : (
        <>
          <div className="field-row">
            <div><span className="label">Agency</span><p>{ev.tenantName || "Unknown"}</p></div>
            <div><span className="label">Client</span><p>{ev.clientName ? ev.clientName : ev.clientId ? `#${ev.clientId}` : "—"}</p></div>
            <div><span className="label">Provider</span><p>{ev.providerLabel}</p></div>
            <div>
              <span className="label">Status</span>
              <p>
                <span className={`badge ${STATUS_BADGE[ev.status] || "badge-neutral"}`}>{STATUS_LABEL[ev.status] || ev.status}</span>
                {ev.recovered ? <span className="badge badge-warning"> Recovered</span> : null}
              </p>
            </div>
          </div>
          <div className="divider" />
          <div className="field-row">
            <div><span className="label">External ID</span><p className="text-sm"><code>{ev.externalLeadId}</code></p></div>
            <div><span className="label">CRM Lead</span><p>{ev.crmLeadId ? <a href={`/admin/leads/${ev.crmLeadId}`} target="_blank" rel="noopener noreferrer">#{ev.crmLeadId}</a> : "—"}</p></div>
            <div><span className="label">Attempts</span><p>{ev.attempts}</p></div>
            <div><span className="label">Next retry</span><p>{ev.nextAttemptAt ? formatDateTime(ev.nextAttemptAt) : "—"}</p></div>
          </div>
          <div className="field-row">
            <div><span className="label">Received</span><p className="text-sm">{formatDateTime(ev.receivedAt)}</p></div>
            <div><span className="label">Processed</span><p className="text-sm">{ev.processedAt ? formatDateTime(ev.processedAt) : "—"}</p></div>
            <div><span className="label">Updated</span><p className="text-sm">{formatDateTime(ev.updatedAt)}</p></div>
            <div><span className="label">Required enrichment</span><p className="text-sm">{ev.needsEnrichment ? "Yes (fetched from provider after receipt)" : "No (complete payload on delivery)"}</p></div>
          </div>
          <div className="divider" />
          <p className="text-sm">{ev.summary}</p>
          {ev.lastError ? (
            <div className="alert alert-warning"><span>⚠</span><span>{ev.lastError}</span></div>
          ) : null}
          {isRetryEligible(ev) ? (
            <div className="mt-3">
              <LoadingButton className="btn btn-primary btn-sm" loading={retrying} onClick={retry}>Retry Now</LoadingButton>
            </div>
          ) : null}
          <div className="divider" />
          <h3 className="card-title" style={{ fontSize: "1rem" }}>Retry History</h3>
          <RetryHistory items={history} />
          <div className="divider" />
          <h3 className="card-title" style={{ fontSize: "1rem" }}>Attribution</h3>
          <Attribution attribution={ev.attribution} />
          <div className="divider" />
          <h3 className="card-title" style={{ fontSize: "1rem" }}>
            Raw payload <span className="text-tertiary text-sm">(tokens/secrets/signatures redacted)</span>
          </h3>
          <pre
            className="text-xs"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", background: "var(--surface-2)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", maxHeight: 280, overflow: "auto" }}
          >
            {JSON.stringify(ev.rawPayload, null, 2)}
          </pre>
        </>
      )}
    </Modal>
  );
}

const PAGE_SIZE = 25;

export default function IntegrationMonitoring() {
  usePageTitle("Integration Monitoring");
  const [agencies, setAgencies] = useState([]);
  const [search, setSearch] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [clientId, setClientId] = useState("");
  const [committedClientId, setCommittedClientId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary] = useState(undefined);
  const [listError, setListError] = useState(null);
  const [detailEventId, setDetailEventId] = useState(null);
  const searchDebounce = useRef(null);
  const clientDebounce = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { tenants } = await superAdminApi.listTenants({});
        setAgencies(tenants);
      } catch {
        setAgencies([]);
      }
    })();
  }, []);

  const refresh = async () => {
    setItems(null);
    setListError(null);
    const query = {
      page,
      pageSize: PAGE_SIZE,
      search: committedSearch || undefined,
      provider: provider || undefined,
      status: status || undefined,
      agencyId: agencyId || undefined,
      clientId: committedClientId || undefined,
      from: from || undefined,
      to: to || undefined,
    };
    try {
      const { items: rows, pagination: p, summary: s } = await superAdminApi.listIntegrationEvents(query);
      setItems(rows);
      setPagination(p);
      setSummary(s);
    } catch (err) {
      setListError(err.message);
    }
  };

  // Every filter/page change re-fetches through this one effect — filter
  // setters below also reset `page` to 1 in the same event, and React
  // batches both updates into a single re-render, so this fires exactly
  // once per user action rather than once per state field touched.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, committedSearch, provider, status, agencyId, committedClientId, from, to]);

  const changeFilter = (setter) => (value) => {
    setter(value);
    setPage(1);
  };
  const onProviderChange = changeFilter(setProvider);
  const onStatusChange = changeFilter(setStatus);
  const onAgencyChange = changeFilter(setAgencyId);
  const onFromChange = changeFilter(setFrom);
  const onToChange = changeFilter(setTo);

  const onSearchChange = (value) => {
    setSearch(value);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setCommittedSearch(value);
      setPage(1);
    }, 350);
  };

  const onClientIdChange = (value) => {
    setClientId(value);
    clearTimeout(clientDebounce.current);
    clientDebounce.current = setTimeout(() => {
      setCommittedClientId(value);
      setPage(1);
    }, 350);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Integration Monitoring</h2>
          <p className="page-subtitle">Every lead-ingestion event across every Agency and Client — diagnose failed, stuck, or retrying deliveries without needing database access.</p>
        </div>
      </div>

      {summary === undefined ? <SkeletonStatCards count={8} /> : <Metrics summary={summary} />}

      <div className="card mb-4">
        <div className="card-body flex gap-3" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 220, marginBottom: 0, flex: 1 }}>
            <label className="label" htmlFor="f-search">Search</label>
            <input className="input" id="f-search" placeholder="Event ID or external lead ID…" value={search} onChange={(e) => onSearchChange(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label className="label" htmlFor="f-provider">Provider</label>
            <select className="select" id="f-provider" value={provider} onChange={(e) => onProviderChange(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label className="label" htmlFor="f-status">Status</label>
            <select className="select" id="f-status" value={status} onChange={(e) => onStatusChange(e.target.value)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 180, marginBottom: 0 }}>
            <label className="label" htmlFor="f-agency">Agency</label>
            <select className="select" id="f-agency" value={agencyId} onChange={(e) => onAgencyChange(e.target.value)}>
              <option value="">All agencies</option>
              {agencies.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 120, marginBottom: 0 }}>
            <label className="label" htmlFor="f-client">Client ID</label>
            <input className="input" id="f-client" placeholder="e.g. 5" inputMode="numeric" value={clientId} onChange={(e) => onClientIdChange(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: 150, marginBottom: 0 }}>
            <label className="label" htmlFor="f-from">From</label>
            <input className="input" type="date" id="f-from" value={from} onChange={(e) => onFromChange(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: 150, marginBottom: 0 }}>
            <label className="label" htmlFor="f-to">To</label>
            <input className="input" type="date" id="f-to" value={to} onChange={(e) => onToChange(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        {listError ? (
          <div className="table-wrap"><ErrorState desc={listError} /></div>
        ) : (
          <DataTable
            columns={eventColumns()}
            rows={items}
            onRowClick={(row) => setDetailEventId(row.id)}
            empty={{ icon: "⌗", title: "No events match these filters", desc: "Try clearing a filter or widening the date range." }}
          />
        )}
        {pagination ? (
          <div className="card-body">
            <Pagination {...pagination} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
          </div>
        ) : null}
      </div>

      <EventDetailModal open={detailEventId !== null} eventId={detailEventId} onClose={() => setDetailEventId(null)} onChanged={() => refresh()} />
    </>
  );
}
