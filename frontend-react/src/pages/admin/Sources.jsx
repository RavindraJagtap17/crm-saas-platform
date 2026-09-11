import { useEffect, useState } from "react";
import { leadSourcesApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";

function SourceFormModal({ open, source, onClose, onSaved }) {
  const isEdit = !!source;
  const [name, setName] = useState(source?.name || "");
  const [type, setType] = useState(source?.type || "");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const body = { name: name.trim(), type: type.trim() || undefined };
      if (isEdit) await leadSourcesApi.update(source.id, body);
      else await leadSourcesApi.create(body);
      toastSuccess(isEdit ? "Source updated." : "Source created.");
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
      title={isEdit ? "Edit source" : "New source"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>{isEdit ? "Save changes" : "Create source"}</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="src-name">Name</label>
          <input className="input" id="src-name" value={name} placeholder="e.g. Referral" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="src-type">
            Type <span className="optional">(optional)</span>
          </label>
          <input className="input" id="src-type" value={type} placeholder="e.g. referral" onChange={(e) => setType(e.target.value)} />
          <span className="hint">A short internal tag — not shown to leads.</span>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default function Sources() {
  usePageTitle("Lead Sources");
  const [sources, setSources] = useState(null);
  const [error, setError] = useState(null);
  const [modalSource, setModalSource] = useState(undefined);

  const refresh = async () => {
    setSources(null);
    setError(null);
    try {
      setSources((await leadSourcesApi.list()).sources);
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
          <h2 className="page-title">Lead Sources</h2>
          <p className="page-subtitle">Where your leads come from.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalSource(null)}>+ New Source</button>
      </div>

      <div className="card">
        {sources === null ? (
          <div className="card-body">{error ? <EmptyState icon="⚠" title="Couldn't load sources" desc={error} /> : <SkeletonRows count={1} />}</div>
        ) : !sources.length ? (
          <div className="card-body"><EmptyState icon="⌘" title="No sources yet" desc="A “Manual” source is created automatically the first time you add a lead by hand." /></div>
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Type</th><th></th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Name" className="table-cell-primary">{s.name}</td>
                    <td data-label="Type">{s.type ? <span className="badge badge-neutral">{s.type}</span> : "—"}</td>
                    <td data-label=""><button className="btn btn-secondary btn-sm" onClick={() => setModalSource(s)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SourceFormModal open={modalSource !== undefined} source={modalSource} onClose={() => setModalSource(undefined)} onSaved={async () => { setModalSource(undefined); await refresh(); }} />
    </>
  );
}
