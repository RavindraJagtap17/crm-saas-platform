import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { clientsApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";

/**
 * Post-Phase-D ownership fix: Custom Field DEFINITIONS are client-scoped
 * DATA (custom_field_definitions.client_id = the selected client — no
 * duplication, no separate agency-level table) but are now MANAGED by
 * Agency Admin, not Client Admin. This page is a client-selector wrapper
 * around the exact same list/create/update flow the old Client Admin
 * page used — only the API surface changed (clientsApi.customFields.*,
 * validated server-side against the caller's own agency) and who's
 * allowed to reach it.
 */

const TYPE_LABELS = { text: "Text", select: "Select", number: "Number", date: "Date", textarea: "Long text" };

function FieldFormModal({ open, clientId, field, onClose, onSaved }) {
  const isEdit = !!field;
  const existingOptions = field?.options ? (Array.isArray(field.options) ? field.options : JSON.parse(field.options)) : [];
  const [label, setLabel] = useState(field?.label || "");
  const [fieldKey, setFieldKey] = useState(field?.field_key || "");
  const [fieldType, setFieldType] = useState(field?.field_type || "text");
  const [options, setOptions] = useState(existingOptions.join(", "));
  const [isActive, setIsActive] = useState(field ? !!field.is_active : true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    const optionList = options.split(",").map((o) => o.trim()).filter(Boolean);
    try {
      if (isEdit) {
        await clientsApi.customFields.update(clientId, field.id, {
          label: label.trim(),
          isActive,
          ...(fieldType === "select" ? { options: optionList } : {}),
        });
      } else {
        await clientsApi.customFields.create(clientId, {
          fieldKey: fieldKey.trim(),
          label: label.trim(),
          fieldType,
          ...(fieldType === "select" ? { options: optionList } : {}),
        });
      }
      toastSuccess(isEdit ? "Custom field updated." : "Custom field created.");
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
      title={isEdit ? "Edit custom field" : "New custom field"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>{isEdit ? "Save changes" : "Create field"}</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="cf-label">Label</label>
          <input className="input" id="cf-label" value={label} placeholder="e.g. Budget" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="cf-key">Field key</label>
            <input className="input" id="cf-key" value={fieldKey} placeholder="budget" disabled={isEdit} onChange={(e) => setFieldKey(e.target.value)} />
            <span className="hint">lowercase, no spaces — used internally, can&apos;t change later</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="cf-type">Type</label>
            <select className="select" id="cf-type" value={fieldType} disabled={isEdit} onChange={(e) => setFieldType(e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </div>
        </div>
        {fieldType === "select" ? (
          <div className="field">
            <label className="label" htmlFor="cf-options">Options <span className="optional">(comma-separated)</span></label>
            <input className="input" id="cf-options" value={options} placeholder="Low, Medium, High" onChange={(e) => setOptions(e.target.value)} />
          </div>
        ) : null}
        {isEdit ? (
          <div className="checkbox-row">
            <input type="checkbox" id="cf-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <label htmlFor="cf-active" className="text-sm">Active</label>
          </div>
        ) : null}
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default function CustomFields() {
  usePageTitle("Custom Fields");
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState(searchParams.get("clientId") || "");
  const [fields, setFields] = useState(null);
  const [fieldsError, setFieldsError] = useState(null);
  const [modalField, setModalField] = useState(undefined);

  useEffect(() => {
    (async () => {
      try {
        const { clients: c } = await clientsApi.list();
        setClients(c);
        const preselect = searchParams.get("clientId");
        if (preselect && c.some((cl) => String(cl.id) === preselect)) {
          setSelectedClientId(preselect);
        }
      } catch (err) {
        setLoadError(err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshFields = async () => {
    if (!selectedClientId) {
      setFields(null);
      return;
    }
    setFields(null);
    setFieldsError(null);
    try {
      const { customFields } = await clientsApi.customFields.list(selectedClientId);
      setFields(customFields);
    } catch (err) {
      setFieldsError(err.message);
    }
  };

  useEffect(() => {
    refreshFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId]);

  const selectClient = (clientId) => {
    setSelectedClientId(clientId);
    const next = new URLSearchParams(searchParams);
    if (clientId) next.set("clientId", clientId);
    else next.delete("clientId");
    setSearchParams(next, { replace: true });
  };

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <div>
            <h2 className="page-title">Custom Fields</h2>
            <p className="page-subtitle">Extra questions a client&apos;s lead forms need. Select a client to manage its fields.</p>
          </div>
        </div>
        <EmptyState title="Couldn't load your clients" desc={loadError} />
      </>
    );
  }

  if (clients !== null && !clients.length) {
    return (
      <>
        <div className="page-header">
          <div>
            <h2 className="page-title">Custom Fields</h2>
            <p className="page-subtitle">Extra questions a client&apos;s lead forms need. Select a client to manage its fields.</p>
          </div>
        </div>
        <EmptyState
          icon="◎"
          title="Add a client first"
          desc="Custom fields belong to one of your clients."
          action={<Link className="btn btn-secondary" to="/agency/clients">Go to Clients</Link>}
        />
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Custom Fields</h2>
          <p className="page-subtitle">Extra questions a client&apos;s lead forms need. Select a client to manage its fields.</p>
        </div>
        <button className="btn btn-primary" disabled={!selectedClientId} onClick={() => setModalField(null)}>+ New Field</button>
      </div>

      <div className="card card-pad mb-4">
        <div className="field" style={{ marginBottom: 0, maxWidth: 360 }}>
          <label className="label" htmlFor="cf-client-select">Client</label>
          <select className="select" id="cf-client-select" value={selectedClientId} onChange={(e) => selectClient(e.target.value)}>
            <option value="">Select a client…</option>
            {(clients || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {!selectedClientId ? (
        <EmptyState icon="✎" title="Select a client" desc="Choose one of your clients above to manage its custom fields." />
      ) : fieldsError ? (
        <div className="card"><div className="card-body"><EmptyState icon="⚠" title="Couldn't load custom fields" desc={fieldsError} /></div></div>
      ) : fields === null ? (
        <div className="card"><div className="card-body"><SkeletonRows count={2} /></div></div>
      ) : !fields.length ? (
        <div className="card">
          <div className="card-body">
            <EmptyState icon="✎" title="No custom fields yet" desc="Add fields this client's lead forms need beyond name, phone, and email — text, select, number, date, or long text. No file uploads." />
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id}>
                    <td data-label="Label" className="table-cell-primary">{f.label}</td>
                    <td data-label="Key" className="table-cell-muted num text-xs">{f.field_key}</td>
                    <td data-label="Type"><span className="badge badge-brand">{TYPE_LABELS[f.field_type] || f.field_type}</span></td>
                    <td data-label="Status">{f.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
                    <td data-label=""><button className="btn btn-secondary btn-sm" onClick={() => setModalField(f)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <FieldFormModal
        open={modalField !== undefined}
        clientId={selectedClientId}
        field={modalField}
        onClose={() => setModalField(undefined)}
        onSaved={async () => { setModalField(undefined); await refreshFields(); }}
      />
    </>
  );
}
