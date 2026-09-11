import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { leadsApi, leadStatusesApi, leadSourcesApi, productsApi, customFieldsApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import DataTable from "../../components/DataTable";
import Pagination from "../../components/Pagination";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess } from "../../components/toast";
import { DuplicateBadge, StatusPill } from "../../components/Badges";
import { EmptyState } from "../../components/States";
import LeadForm, { emptyLeadFormValue, leadFormValueToBody, fieldErrorsFromMessage } from "../../components/LeadForm";
import { formatDate } from "../../utils/format";

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

export default function Leads() {
  usePageTitle("Leads");
  const navigate = useNavigate();
  const [refData, setRefData] = useState(null);
  const [refError, setRefError] = useState(null);
  const [items, setItems] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [qInput, setQInput] = useState("");
  const [listError, setListError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      leadStatusesApi.list().then((r) => r.statuses),
      leadSourcesApi.list().then((r) => r.sources),
      productsApi.list().then((r) => r.products),
      customFieldsApi.list().then((r) => r.customFields),
    ])
      .then(([statuses, sources, products, customFields]) => setRefData({ statuses, sources, products, customFields }))
      .catch((err) => setRefError(err.message));
  }, []);

  const refreshList = useCallback(async () => {
    setItems(null);
    try {
      const { items: rows, pagination: p } = await leadsApi.list({ page, pageSize: PAGE_SIZE, ...filters });
      setItems(rows);
      setPagination(p);
    } catch (err) {
      setListError(err.message);
    }
  }, [page, filters]);

  useEffect(() => {
    if (refData) refreshList();
  }, [refData, refreshList]);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((prev) => ({ ...prev, q: qInput.trim() || undefined }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const statusById = useMemo(() => new Map((refData?.statuses || []).map((s) => [String(s.id), s])), [refData]);
  const sourceById = useMemo(() => new Map((refData?.sources || []).map((s) => [String(s.id), s])), [refData]);
  const productById = useMemo(() => new Map((refData?.products || []).map((p) => [String(p.id), p])), [refData]);

  const columns = [
    {
      key: "lead",
      label: "Lead",
      render: (r) => (
        <>
          <span className="table-cell-primary">{r.name || "(no name)"}</span> <DuplicateBadge isDuplicate={r.isDuplicate} />
          <div className="table-cell-muted text-xs">{r.phone}{r.phone && r.email ? " · " : ""}{r.email}</div>
        </>
      ),
    },
    { key: "status", label: "Status", render: (r) => <StatusPill name={statusById.get(String(r.statusId))?.name} color={statusById.get(String(r.statusId))?.color} /> },
    { key: "source", label: "Source", render: (r) => sourceById.get(String(r.sourceId))?.name || "—" },
    { key: "product", label: "Product", render: (r) => productById.get(String(r.productId))?.name || "—" },
    { key: "created", label: "Created", render: (r) => <span className="text-secondary text-sm">{formatDate(r.createdAt)}</span> },
  ];

  if (refError) return <EmptyState title="Couldn't load setup data" desc={refError} />;
  if (!refData) return null;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Leads</h2>
          <p className="page-subtitle">All leads for your client.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ New Lead</button>
      </div>

      <div className="card mb-4">
        <div className="card-body flex gap-3" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 220, marginBottom: 0, flex: 1 }}>
            <label className="label" htmlFor="f-q">Search</label>
            <input className="input" id="f-q" placeholder="Name, phone, or email…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label className="label" htmlFor="f-status">Status</label>
            <select
              className="select"
              id="f-status"
              value={filters.statusId || ""}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, statusId: e.target.value || undefined }));
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {refData.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {listError ? (
        <div className="table-wrap"><EmptyState icon="⚠" title="Couldn't load leads" desc={listError} /></div>
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          onRowClick={(row) => navigate(`/employee/leads/${row.id}`)}
          empty={{ icon: "☍", title: "No leads match these filters", desc: "Try clearing a filter — this list shows every lead for your client." }}
        />
      )}
      {pagination ? <Pagination {...pagination} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} /> : null}

      <CreateLeadModal open={createOpen} refData={refData} onClose={() => setCreateOpen(false)} onCreated={(lead) => { setCreateOpen(false); navigate(`/employee/leads/${lead.id}`); }} />
    </>
  );
}
