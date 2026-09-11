import { useEffect, useState } from "react";
import { leadStatusesApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";

const DEFAULT_COLOR = "#4f46e5";

function StatusFormModal({ open, status, onClose, onSaved }) {
  const isEdit = !!status;
  const [name, setName] = useState(status?.name || "");
  const [color, setColor] = useState(status?.color || DEFAULT_COLOR);
  const [sortOrder, setSortOrder] = useState(status?.sort_order ?? 0);
  const [isFinal, setIsFinal] = useState(!!status?.is_final);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    const body = { name: name.trim(), color, sortOrder: Number(sortOrder) || 0, isFinal };
    try {
      if (isEdit) await leadStatusesApi.update(status.id, body);
      else await leadStatusesApi.create(body);
      toastSuccess(isEdit ? "Status updated." : "Status created.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? "Edit status" : "New status"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>{isEdit ? "Save changes" : "Create status"}</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="s-name">Name</label>
          <input className="input" id="s-name" value={name} placeholder="e.g. Hot" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="s-color">Color</label>
            <input className="input" type="color" id="s-color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 40, padding: 4 }} />
          </div>
          <div className="field">
            <label className="label" htmlFor="s-sort">Sort order</label>
            <input className="input" type="number" id="s-sort" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
        </div>
        <div className="checkbox-row">
          <input type="checkbox" id="s-final" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} />
          <label htmlFor="s-final" className="text-sm">This is a final pipeline stage (e.g. Converted, Lost)</label>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default function Statuses() {
  usePageTitle("Lead Statuses");
  const [statuses, setStatuses] = useState(null);
  const [error, setError] = useState(null);
  const [modalStatus, setModalStatus] = useState(undefined); // undefined = closed, null = create, object = edit

  const refresh = async () => {
    setStatuses(null);
    setError(null);
    try {
      setStatuses((await leadStatusesApi.list()).statuses);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Lead Statuses</h2>
          <p className="page-subtitle">Your pipeline stages — reorder by editing the sort order.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalStatus(null)}>+ New Status</button>
      </div>

      <div className="card">
        {statuses === null ? (
          <div className="card-body">{error ? <EmptyState icon="⚠" title="Couldn't load statuses" desc={error} /> : <SkeletonRows count={2} />}</div>
        ) : !statuses.length ? (
          <div className="card-body"><EmptyState icon="◔" title="No statuses yet" desc="Create your first pipeline stage, like “New” or “Hot”." /></div>
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead><tr><th>Status</th><th>Sort order</th><th>Final</th><th></th></tr></thead>
              <tbody>
                {statuses.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Status">
                      <span className="status-pill">
                        <span className="dot" style={{ background: s.color || DEFAULT_COLOR }} />
                        {s.name}
                      </span>
                    </td>
                    <td data-label="Sort order" className="num">{s.sort_order}</td>
                    <td data-label="Final">{s.is_final ? <span className="badge badge-success">Final</span> : <span className="text-tertiary">—</span>}</td>
                    <td data-label=""><button className="btn btn-secondary btn-sm" onClick={() => setModalStatus(s)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StatusFormModal open={modalStatus !== undefined} status={modalStatus} onClose={() => setModalStatus(undefined)} onSaved={async () => { setModalStatus(undefined); await refresh(); }} />
    </>
  );
}
