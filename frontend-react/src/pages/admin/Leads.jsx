import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { leadsApi, leadStatusesApi, leadSourcesApi, productsApi, customFieldsApi, usersApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import DataTable from "../../components/DataTable";
import Pagination from "../../components/Pagination";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { confirmDialog } from "../../components/confirmDialog";
import { toastSuccess, toastError } from "../../components/toast";
import { DuplicateBadge, StatusPill } from "../../components/Badges";
import { EmptyState } from "../../components/States";
import LeadForm, { emptyLeadFormValue, leadFormValueToBody, fieldErrorsFromMessage } from "../../components/LeadForm";
import { formatDate } from "../../utils/format";
import { triggerDownload } from "../../utils/download";

const PAGE_SIZE = 20;

function CreateLeadModal({ open, refData, onClose, onCreated }) {
  const [value, setValue] = useState(emptyLeadFormValue());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setErrors({});
    setSaving(true);
    try {
      const { lead } = await leadsApi.create(leadFormValueToBody(value, refData.customFields));
      toastSuccess(lead.isDuplicate ? "Lead created — flagged as a possible duplicate." : "Lead created.");
      onCreated(lead);
    } catch (err) {
      setErrors(fieldErrorsFromMessage(err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="New lead"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>Create lead</LoadingButton>
        </>
      }
    >
      <LeadForm sources={refData.sources} products={refData.products} customFieldDefs={refData.customFields} value={value} onChange={setValue} fieldErrors={errors} />
    </Modal>
  );
}

function BulkAssignModal({ open, count, users, onClose, onSubmit }) {
  const activeUsers = users.filter((u) => u.status === "active");
  const [assignedTo, setAssignedTo] = useState(activeUsers[0]?.id || "");
  const [saving, setSaving] = useState(false);
  if (!open) return null;
  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit(Number(assignedTo));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      title={`Assign ${count} lead${count === 1 ? "" : "s"}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>Assign</LoadingButton>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="bulk-assign-select">Assign to</label>
        <select className="select" id="bulk-assign-select" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          {activeUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.role.replace("client_", "")})</option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

function BulkStatusModal({ open, count, statuses, onClose, onSubmit }) {
  const [statusId, setStatusId] = useState(statuses[0]?.id || "");
  const [saving, setSaving] = useState(false);
  if (!open) return null;
  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit(Number(statusId));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      title={`Change status for ${count} lead${count === 1 ? "" : "s"}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>Update</LoadingButton>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="bulk-status-select">New status</label>
        <select className="select" id="bulk-status-select" value={statusId} onChange={(e) => setStatusId(e.target.value)}>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

// CSV Import — three in-place steps (upload -> preview -> result) within
// one modal, matching the old frontend's admin-leads.js openImportModal().
function ImportCsvModal({ open, refData, onClose, onImported }) {
  const [step, setStep] = useState("upload");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const doPreview = async () => {
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const p = await leadsApi.previewImport(file);
      setPreview(p);
      setStep("preview");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async () => {
    setBusy(true);
    try {
      const r = await leadsApi.confirmImport(preview.token);
      setResult(r);
      setStep("result");
      toastSuccess(`${r.imported} lead${r.imported === 1 ? "" : "s"} imported.`);
    } catch (err) {
      toastError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const activeCustomFieldLabels = (refData.customFields || []).filter((f) => f.is_active).map((f) => f.label);
    const headers = ["Name", "Phone", "Email", "Status", "Source", "Product", "Assigned Employee", ...activeCustomFieldLabels];
    const csvEscape = (v) => {
      const s = String(v ?? "");
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "﻿" + headers.map(csvEscape).join(",") + "\r\n";
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), "lead-import-template.csv");
  };

  const close = () => {
    onClose();
    reset();
  };

  const problemRows = preview?.rows.filter((r) => r.status !== "ready") || [];

  return (
    <Modal
      open={open}
      title="Import Leads from CSV"
      onClose={close}
      footer={
        step === "upload" ? (
          <>
            <button className="btn btn-secondary" onClick={close}>Close</button>
            <LoadingButton className="btn btn-primary" loading={busy} onClick={doPreview}>Upload &amp; Preview</LoadingButton>
          </>
        ) : step === "preview" ? (
          <>
            <button className="btn btn-secondary" onClick={reset}>Choose Different File</button>
            <LoadingButton className="btn btn-primary" loading={busy} disabled={preview.readyCount === 0} onClick={doConfirm}>
              {preview.readyCount > 0 ? `Import ${preview.readyCount} Lead${preview.readyCount === 1 ? "" : "s"}` : "Nothing to Import"}
            </LoadingButton>
          </>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => {
              close();
              onImported();
            }}
          >
            Done
          </button>
        )
      }
    >
      {step === "upload" ? (
        <>
          <p className="text-sm text-secondary mb-3">
            Recognized columns: Name, Phone, Email, Status, Source, Product, Assigned Employee, and any of your Client's active custom fields (matched by column header — a file
            exported from this page already uses these exact names). New leads only — an existing lead is never updated by an import.{" "}
            <a href="#template" onClick={(e) => { e.preventDefault(); downloadTemplate(); }}>Download a blank CSV template</a> with those columns already filled in.
          </p>
          <div className="field">
            <label className="label" htmlFor="import-file-input">CSV file</label>
            <input type="file" className="input" id="import-file-input" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          {error ? <div className="alert alert-danger">{error}</div> : null}
        </>
      ) : step === "preview" ? (
        <>
          <p className="text-sm text-secondary mb-3">{preview.filename}</p>
          <div className="grid-stats mb-4" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            <div className="card stat-card"><span className="stat-label">Total Rows</span><span className="stat-value">{preview.totalRows}</span></div>
            <div className="card stat-card"><span className="stat-label">Ready</span><span className="stat-value">{preview.readyCount}</span></div>
            <div className="card stat-card"><span className="stat-label">Duplicates</span><span className="stat-value">{preview.duplicateCount}</span></div>
            <div className="card stat-card"><span className="stat-label">Invalid</span><span className="stat-value">{preview.invalidCount}</span></div>
          </div>
          {preview.fileWarnings.length ? (
            <div className="alert alert-warning mb-3">
              <span>⚠</span>
              <span>{preview.fileWarnings.map((w, i) => <span key={i}>{w}<br /></span>)}</span>
            </div>
          ) : null}
          {preview.duplicateCount > 0 ? <p className="text-sm text-tertiary mb-2">Duplicate rows are skipped — they will not be imported.</p> : null}
          {problemRows.length ? (
            <div className="table-wrap" style={{ maxHeight: 280, overflow: "auto" }}>
              <table className="data-table">
                <thead><tr><th>Row</th><th>Status</th><th>Details</th></tr></thead>
                <tbody>
                  {problemRows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td>{r.rowNumber}</td>
                      <td><span className={`badge ${r.status === "invalid" ? "badge-danger" : "badge-neutral"}`}>{r.status === "invalid" ? "Invalid" : "Duplicate"}</span></td>
                      <td className="text-sm">{r.status === "invalid" ? r.errors.join(" ") : r.duplicateReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-tertiary text-sm">Every row is ready to import.</p>
          )}
          {preview.totalRows > preview.rows.length ? <p className="text-tertiary text-xs mt-2">Showing the first {preview.rows.length} of {preview.totalRows} rows.</p> : null}
        </>
      ) : (
        <>
          <div className="grid-stats mb-4" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            <div className="card stat-card"><span className="stat-label">Imported</span><span className="stat-value">{result.imported}</span></div>
            <div className="card stat-card"><span className="stat-label">Skipped Duplicates</span><span className="stat-value">{result.skippedDuplicates}</span></div>
            <div className="card stat-card"><span className="stat-label">Skipped Invalid</span><span className="stat-value">{result.skippedInvalid}</span></div>
            <div className="card stat-card"><span className="stat-label">Failed</span><span className="stat-value">{result.failed}</span></div>
          </div>
          {result.failures.length ? (
            <div className="alert alert-danger mb-3">
              <span>⚠</span>
              <span>{result.failures.map((f) => <span key={f.rowNumber}>Row {f.rowNumber}: {f.error}<br /></span>)}</span>
            </div>
          ) : null}
          {result.partialFailures.length ? (
            <div className="alert alert-warning mb-3">
              <span>⚠</span>
              <span>{result.partialFailures.map((f) => <span key={f.rowNumber}>Row {f.rowNumber} (lead #{f.leadId}): {f.error}<br /></span>)}</span>
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
}

export default function Leads() {
  usePageTitle("Leads");
  const navigate = useNavigate();
  const [refData, setRefData] = useState(null);
  const [refError, setRefError] = useState(null);
  const [items, setItems] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [listError, setListError] = useState(null);
  const [modal, setModal] = useState(null); // "create" | "bulk-assign" | "bulk-status" | "import" | null
  const [qInput, setQInput] = useState("");

  useEffect(() => {
    Promise.all([
      leadStatusesApi.list().then((r) => r.statuses),
      leadSourcesApi.list().then((r) => r.sources),
      productsApi.list(true).then((r) => r.products),
      customFieldsApi.list().then((r) => r.customFields),
      usersApi.list().then((r) => r.users).catch(() => []),
    ])
      .then(([statuses, sources, products, customFields, users]) => setRefData({ statuses, sources, products, customFields, users }))
      .catch((err) => setRefError(err.message));
  }, []);

  const refreshList = useCallback(async () => {
    setItems(null);
    const query = {
      page,
      pageSize: PAGE_SIZE,
      q: filters.q,
      statusId: filters.statusId,
      sourceId: filters.sourceId,
      productId: filters.productId,
      assignedTo: filters.assignedTo,
      unassignedOnly: filters.unassignedOnly ? "true" : undefined,
      isDuplicate: filters.isDuplicate,
    };
    try {
      const { items: rows, pagination: p } = await leadsApi.list(query);
      setItems(rows);
      setPagination(p);
      const pageIds = new Set(rows.map((l) => l.id));
      setSelectedIds((prev) => new Set([...prev].filter((id) => pageIds.has(id))));
    } catch (err) {
      setListError(err.message);
    }
  }, [page, filters]);

  useEffect(() => {
    if (refData) refreshList();
  }, [refData, refreshList]);

  const setFilter = (patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    const t = setTimeout(() => setFilter({ q: qInput.trim() || undefined }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const statusById = useMemo(() => new Map((refData?.statuses || []).map((s) => [String(s.id), s])), [refData]);
  const sourceById = useMemo(() => new Map((refData?.sources || []).map((s) => [String(s.id), s])), [refData]);
  const productById = useMemo(() => new Map((refData?.products || []).map((p) => [String(p.id), p])), [refData]);
  const userById = useMemo(() => new Map((refData?.users || []).map((u) => [String(u.id), u])), [refData]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pageIds = items ? items.map((l) => l.id) : [];
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const toggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const columns = [
    {
      key: "select",
      label: "",
      render: (r) => <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${r.name || r.phone || "lead"}`} />,
    },
    {
      key: "lead",
      label: "Lead",
      render: (r) => (
        <>
          <a className="table-cell-primary" href={`/admin/leads/${r.id}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/leads/${r.id}`); }}>
            {r.name || "(no name)"}
          </a>{" "}
          <DuplicateBadge isDuplicate={r.isDuplicate} />
          <div className="table-cell-muted text-xs">{r.phone}{r.phone && r.email ? " · " : ""}{r.email}</div>
        </>
      ),
    },
    { key: "status", label: "Status", render: (r) => <StatusPill name={statusById.get(String(r.statusId))?.name} color={statusById.get(String(r.statusId))?.color} /> },
    { key: "source", label: "Source", render: (r) => sourceById.get(String(r.sourceId))?.name || "—" },
    { key: "product", label: "Product", render: (r) => productById.get(String(r.productId))?.name || "—" },
    { key: "assigned", label: "Assigned to", render: (r) => (r.assignedTo ? userById.get(String(r.assignedTo))?.name || `#${r.assignedTo}` : <span className="text-tertiary">Unassigned</span>) },
    { key: "created", label: "Created", render: (r) => <span className="text-secondary text-sm">{formatDate(r.createdAt)}</span> },
  ];

  const exportFiltered = async (e) => {
    const total = pagination?.total ?? 0;
    if (total > PAGE_SIZE) {
      const ok = await confirmDialog({ title: "Export all matching leads?", message: `This will export all ${total} leads matching your current filters, not just this page.`, confirmLabel: "Export" });
      if (!ok) return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { blob, filename } = await leadsApi.exportFiltered({
        q: filters.q,
        statusId: filters.statusId,
        sourceId: filters.sourceId,
        productId: filters.productId,
        assignedTo: filters.assignedTo,
        unassignedOnly: filters.unassignedOnly ? "true" : undefined,
        isDuplicate: filters.isDuplicate,
      });
      triggerDownload(blob, filename);
    } catch (err) {
      toastError(err.message);
    } finally {
      btn.disabled = false;
    }
  };

  const exportSelected = async () => {
    try {
      const { blob, filename } = await leadsApi.exportSelected([...selectedIds]);
      triggerDownload(blob, filename);
    } catch (err) {
      toastError(err.message);
    }
  };

  if (refError) return <EmptyState title="Couldn't load setup data" desc={refError} />;
  if (!refData) return <div className="card-body"><div className="skeleton skeleton-row" /></div>;

  const selectedCount = selectedIds.size;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Leads</h2>
          <p className="page-subtitle">All leads for your client.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => setModal("import")}>Import CSV</button>
          <button className="btn btn-secondary" onClick={exportFiltered}>Export All Filtered</button>
          <button className="btn btn-primary" onClick={() => setModal("create")}>+ New Lead</button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body flex gap-3" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 220, marginBottom: 0, flex: 1 }}>
            <label className="label" htmlFor="f-q">Search</label>
            <input className="input" id="f-q" placeholder="Name, phone, or email…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label className="label" htmlFor="f-status">Status</label>
            <select className="select" id="f-status" value={filters.statusId || ""} onChange={(e) => setFilter({ statusId: e.target.value || undefined })}>
              <option value="">All statuses</option>
              {refData.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label className="label" htmlFor="f-source">Source</label>
            <select className="select" id="f-source" value={filters.sourceId || ""} onChange={(e) => setFilter({ sourceId: e.target.value || undefined })}>
              <option value="">All sources</option>
              {refData.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label className="label" htmlFor="f-product">Product</label>
            <select className="select" id="f-product" value={filters.productId || ""} onChange={(e) => setFilter({ productId: e.target.value || undefined })}>
              <option value="">All products</option>
              {refData.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label className="label" htmlFor="f-assigned">Assigned to</label>
            <select
              className="select"
              id="f-assigned"
              value={filters.unassignedOnly ? "unassigned" : filters.assignedTo || ""}
              onChange={(e) => {
                if (e.target.value === "unassigned") setFilter({ assignedTo: undefined, unassignedOnly: true });
                else setFilter({ assignedTo: e.target.value || undefined, unassignedOnly: false });
              }}
            >
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {refData.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="checkbox-row" style={{ marginBottom: 9 }}>
            <input type="checkbox" id="f-dup" checked={!!filters.isDuplicate} onChange={(e) => setFilter({ isDuplicate: e.target.checked ? "true" : undefined })} />
            <label htmlFor="f-dup" className="text-sm">Duplicates only</label>
          </div>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body flex items-center gap-3" style={{ flexWrap: "wrap" }}>
          <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={allOnPageSelected} disabled={pageIds.length === 0} onChange={toggleSelectAllPage} />
            Select all on this page
          </label>
          <span className="text-sm text-secondary">{selectedCount} selected</span>
          {selectedCount > 0 ? (
            <div className="flex gap-2" style={{ marginLeft: "auto" }}>
              <button className="btn btn-secondary btn-sm" onClick={exportSelected}>Export Selected</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setModal("bulk-assign")}>Assign</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setModal("bulk-status")}>Change Status</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())}>Clear</button>
            </div>
          ) : null}
        </div>
      </div>

      {listError ? (
        <div className="table-wrap"><EmptyState icon="⚠" title="Couldn't load leads" desc={listError} /></div>
      ) : (
        <DataTable columns={columns} rows={items} empty={{ icon: "☍", title: "No leads match these filters", desc: "Try clearing a filter, or create a new lead to get started." }} />
      )}
      {pagination ? (
        <Pagination {...pagination} onPrev={() => { setPage((p) => p - 1); setSelectedIds(new Set()); }} onNext={() => { setPage((p) => p + 1); setSelectedIds(new Set()); }} />
      ) : null}

      <CreateLeadModal open={modal === "create"} refData={refData} onClose={() => setModal(null)} onCreated={(lead) => { setModal(null); navigate(`/admin/leads/${lead.id}`); }} />

      <BulkAssignModal
        open={modal === "bulk-assign"}
        count={selectedCount}
        users={refData.users}
        onClose={() => setModal(null)}
        onSubmit={async (assignedTo) => {
          try {
            const { assignedCount } = await leadsApi.bulkAssign([...selectedIds], assignedTo);
            toastSuccess(`${assignedCount} lead${assignedCount === 1 ? "" : "s"} assigned.`);
            setModal(null);
            setSelectedIds(new Set());
            await refreshList();
          } catch (err) {
            toastError(err.message);
          }
        }}
      />

      <BulkStatusModal
        open={modal === "bulk-status"}
        count={selectedCount}
        statuses={refData.statuses}
        onClose={() => setModal(null)}
        onSubmit={async (statusId) => {
          try {
            const { updatedCount } = await leadsApi.bulkChangeStatus([...selectedIds], statusId);
            toastSuccess(`${updatedCount} lead${updatedCount === 1 ? "" : "s"} updated.`);
            setModal(null);
            setSelectedIds(new Set());
            await refreshList();
          } catch (err) {
            toastError(err.message);
          }
        }}
      />

      <ImportCsvModal open={modal === "import"} refData={refData} onClose={() => setModal(null)} onImported={refreshList} />
    </>
  );
}
