import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { metaApi, customFieldsApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { confirmDialog } from "../../components/confirmDialog";
import { toastSuccess, toastError } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";
import { formatDateTime } from "../../utils/format";

// §F/§I: CRM field keys a mapping may point to are either one of these
// three fixed core fields (mapped straight onto the lead) or one of the
// tenant's own active custom field definitions — nothing else.
const CORE_FIELDS = [
  { key: "name", label: "Name (core)" },
  { key: "phone", label: "Phone (core)" },
  { key: "email", label: "Email (core)" },
];

function crmFieldLabel(key, customFields) {
  const core = CORE_FIELDS.find((f) => f.key === key);
  if (core) return core.label;
  const cf = customFields.find((f) => f.field_key === key);
  return cf ? cf.label : key;
}

function CrmFieldSelect({ id, value, onChange, customFields }) {
  return (
    <select className="select" id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Core fields">
        {CORE_FIELDS.map((f) => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </optgroup>
      {customFields.length ? (
        <optgroup label="Custom fields">
          {customFields.map((f) => (
            <option key={f.field_key} value={f.field_key}>{f.label}</option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}

function MappingFormModal({ open, formId, mapping, customFields, onClose, onSaved }) {
  const isEdit = !!mapping;
  const [metaFieldKey, setMetaFieldKey] = useState(mapping?.meta_field_key || "");
  const [crmFieldKey, setCrmFieldKey] = useState(mapping?.crm_field_key || CORE_FIELDS[0].key);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      if (isEdit) {
        await metaApi.updateMapping(mapping.id, { crmFieldKey });
      } else {
        const key = metaFieldKey.trim();
        if (!key) throw new Error("Enter the Meta field key.");
        await metaApi.createMapping({ metaFormId: formId, metaFieldKey: key, crmFieldKey });
      }
      toastSuccess(isEdit ? "Mapping updated." : "Mapping added.");
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
      title={isEdit ? "Edit field mapping" : "New field mapping"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>{isEdit ? "Save changes" : "Add mapping"}</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="mm-meta-key">Meta field key</label>
          <input
            className="input"
            id="mm-meta-key"
            value={metaFieldKey}
            placeholder="e.g. full_name"
            disabled={isEdit}
            onChange={(e) => setMetaFieldKey(e.target.value)}
          />
          <span className="hint">The raw field name Meta sends for this form — check a real test submission, or the field name shown in Meta's Forms Library.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="mm-crm-key">CRM field</label>
          <CrmFieldSelect id="mm-crm-key" value={crmFieldKey} onChange={setCrmFieldKey} customFields={customFields} />
          <span className="hint">Core fields go straight onto the lead. Anything else is stored in custom fields — create it on the Custom Fields page first if it's missing here.</span>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

function MappingSection({ formId, customFields }) {
  const [mappings, setMappings] = useState(null);
  const [error, setError] = useState(null);
  const [modalMapping, setModalMapping] = useState(undefined);

  const refresh = async () => {
    setMappings(null);
    setError(null);
    try {
      const { mappings: m } = await metaApi.mappings(formId);
      setMappings(m);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  const remove = async (id) => {
    const ok = await confirmDialog({
      title: "Remove this mapping?",
      message: "New leads from this form will drop this field instead of storing it, until you add a new mapping.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await metaApi.removeMapping(id);
      toastSuccess("Mapping removed.");
      await refresh();
    } catch (err) {
      toastError(err.message);
    }
  };

  return (
    <>
      <div className="divider" />
      {error ? (
        <EmptyState icon="⚠" title="Couldn't load mappings" desc={error} />
      ) : mappings === null ? (
        <SkeletonRows count={1} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="card-title">Field mapping — form {formId}</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setModalMapping(null)}>+ Add mapping</button>
          </div>
          <div className="mt-3">
            {!mappings.length ? (
              <EmptyState
                icon="⇄"
                title="No field mappings yet"
                desc="Map this form's Meta field keys (e.g. full_name, phone_number) to CRM fields. Any Meta field left unmapped is dropped when a lead comes in — never stored silently."
              />
            ) : (
              <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
                <table className="data-table">
                  <thead><tr><th>Meta field key</th><th>CRM field</th><th></th></tr></thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m.id}>
                        <td data-label="Meta field key" className="table-cell-primary">{m.meta_field_key}</td>
                        <td data-label="CRM field">{crmFieldLabel(m.crm_field_key, customFields)}</td>
                        <td data-label="" className="flex gap-2">
                          <button className="btn btn-secondary btn-sm" onClick={() => setModalMapping(m)}>Edit</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => remove(m.id)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      <MappingFormModal
        open={modalMapping !== undefined}
        formId={formId}
        mapping={modalMapping}
        customFields={customFields}
        onClose={() => setModalMapping(undefined)}
        onSaved={async () => { setModalMapping(undefined); await refresh(); }}
      />
    </>
  );
}

function FormsCard({ connected, customFields }) {
  const [forms, setForms] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [manualFormId, setManualFormId] = useState("");
  const [selectedFormId, setSelectedFormId] = useState(null);

  if (!connected) {
    return (
      <div className="card mb-4">
        <div className="card-body">
          <EmptyState icon="▤" title="Connect Meta first" desc="Form discovery and field mapping become available once a Meta account is connected above." />
        </div>
      </div>
    );
  }

  const loadForms = async () => {
    setLoading(true);
    setError(null);
    setForms(null);
    try {
      const { forms: f } = await metaApi.forms();
      setForms(f);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const useManualForm = () => {
    const id = manualFormId.trim();
    if (!id) return;
    setSelectedFormId(id);
  };

  return (
    <div className="card mb-4">
      <div className="card-body flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="label">Meta Lead Ads forms on this Page</span>
            <p className="text-tertiary text-sm">Field mappings are configured per Meta form — load or pick a form to configure it.</p>
          </div>
          <LoadingButton className="btn btn-secondary btn-sm" loading={loading} onClick={loadForms}>Load forms</LoadingButton>
        </div>
        <div>
          {error ? (
            <p className="text-tertiary text-sm">{error}</p>
          ) : forms === null ? null : !forms.length ? (
            <p className="text-tertiary text-sm">No Lead Ads forms found for this Page yet.</p>
          ) : (
            forms.map((f) => (
              <button key={f.id} className="btn btn-secondary btn-sm mr-2 mb-2" onClick={() => setSelectedFormId(f.id)}>{f.name || f.id}</button>
            ))
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="manual-form-id">Or enter a Meta form ID manually</label>
          <div className="flex gap-2">
            <input className="input" id="manual-form-id" placeholder="1234567890" style={{ flex: 1 }} value={manualFormId} onChange={(e) => setManualFormId(e.target.value)} />
            <button className="btn btn-secondary" onClick={useManualForm}>Use</button>
          </div>
        </div>
        {selectedFormId ? <MappingSection formId={selectedFormId} customFields={customFields} /> : null}
      </div>
    </div>
  );
}

function ConnectionCard({ onConnectionChange }) {
  const [connection, setConnection] = useState(undefined);
  const [error, setError] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pixelId, setPixelId] = useState("");
  const [savingPixel, setSavingPixel] = useState(false);

  const refresh = async () => {
    setConnection(undefined);
    setError(null);
    try {
      const c = await metaApi.connection();
      setConnection(c);
      setPixelId(c.pixelId || "");
      onConnectionChange(c);
    } catch (err) {
      setError(err.message);
      onConnectionChange(null);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startConnect = async () => {
    setConnecting(true);
    try {
      const { authorizationUrl } = await metaApi.connect();
      // Full-page navigation to Meta's OAuth dialog — the Bearer token
      // stayed in the Authorization header for the /connect call above;
      // it has no business being in this URL (see meta.controller.js).
      window.location.href = authorizationUrl;
    } catch (err) {
      toastError(err.message);
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: "Disconnect Meta account?",
      message: "New Lead Ads submissions will stop being imported until you reconnect. Existing leads and field mappings are kept.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      await metaApi.disconnect();
      toastSuccess("Meta account disconnected.");
      await refresh();
    } catch (err) {
      toastError(err.message);
    } finally {
      setDisconnecting(false);
    }
  };

  const savePixel = async () => {
    setSavingPixel(true);
    try {
      await metaApi.updateConnection({ pixelId: pixelId.trim() });
      toastSuccess("Pixel ID saved.");
    } catch (err) {
      toastError(err.message);
    } finally {
      setSavingPixel(false);
    }
  };

  if (connection === undefined) {
    return (
      <div className="card mb-4">
        <div className="card-body">{error ? <EmptyState icon="⚠" title="Couldn't load connection status" desc={error} /> : <SkeletonRows count={1} />}</div>
      </div>
    );
  }

  if (!connection.connected) {
    return (
      <div className="card mb-4">
        <div className="card-body flex-col gap-4">
          <EmptyState icon="◈" title="No Meta account connected" desc="Connect a Facebook Page to start receiving Lead Ads submissions automatically." />
          <LoadingButton className="btn btn-primary" loading={connecting} onClick={startConnect}>Connect Meta</LoadingButton>
        </div>
      </div>
    );
  }

  return (
    <div className="card mb-4">
      <div className="card-body flex-col gap-4">
        {connection.isExpired ? (
          <div className="alert alert-warning">
            <span>⚠</span>
            <span>Your Meta connection has expired or been revoked. Reconnect to keep receiving leads — your field mappings are kept.</span>
          </div>
        ) : null}
        <div className="field-row">
          <div>
            <span className="label">Page</span>
            <p>{connection.pageName || connection.pageId}</p>
          </div>
          <div>
            <span className="label">Ad account</span>
            <p>{connection.adAccountId || "—"}</p>
          </div>
          <div>
            <span className="label">Token expires</span>
            <p>{connection.tokenExpiresAt ? formatDateTime(connection.tokenExpiresAt) : "Not reported by Meta (no automatic refresh — see docs)"}</p>
          </div>
          <div>
            <span className="label">Status</span>
            <p><span className={`badge ${connection.isExpired ? "badge-danger" : "badge-success"}`}>{connection.isExpired ? "Expired" : "Connected"}</span></p>
          </div>
        </div>
        <div className="flex gap-3">
          {connection.isExpired ? (
            <LoadingButton className="btn btn-primary" loading={connecting} onClick={startConnect}>Reconnect</LoadingButton>
          ) : null}
          <LoadingButton className="btn btn-secondary" loading={disconnecting} onClick={disconnect}>Disconnect</LoadingButton>
        </div>
        <div className="divider" />
        <div className="field">
          <label className="label" htmlFor="pixel-id-input">
            Meta Pixel / Dataset ID <span className="optional">(for Conversions API)</span>
          </label>
          <div className="flex gap-2">
            <input className="input" id="pixel-id-input" value={pixelId} placeholder="e.g. 123456789012345" style={{ flex: 1 }} onChange={(e) => setPixelId(e.target.value)} />
            <LoadingButton className="btn btn-secondary" loading={savingPixel} onClick={savePixel}>Save</LoadingButton>
          </div>
          <span className="hint">Where a lead's conversion event is sent once it reaches your configured final status. Find this in Meta Events Manager — it isn't something we can detect automatically.</span>
        </div>
      </div>
    </div>
  );
}

const CAPI_STATUS_BADGE = {
  pending: "badge-neutral",
  processing: "badge-neutral",
  sent: "badge-success",
  failed_temporary: "badge-warning",
  failed_permanent: "badge-danger",
};
const CAPI_STATUS_LABEL = {
  pending: "Pending",
  processing: "Sending",
  sent: "Sent",
  failed_temporary: "Retrying",
  failed_permanent: "Failed",
};

// Step 8 §K: minimum operational visibility, not a reporting dashboard —
// just enough for a Tenant Admin to see whether conversions are actually
// going out and why one didn't.
function CapiCard() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { events: e } = await metaApi.capiEvents();
        setEvents(e);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  return (
    <div className="card">
      {error ? (
        <div className="card-body"><EmptyState icon="⚠" title="Couldn't load conversion events" desc={error} /></div>
      ) : events === null ? (
        <div className="card-body"><SkeletonRows count={1} /></div>
      ) : !events.length ? (
        <div className="card-body">
          <EmptyState icon="⇪" title="No conversions sent yet" desc="When a lead reaches your client's configured final status, a Meta Conversions API event is sent automatically and will show up here." />
        </div>
      ) : (
        <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="data-table">
            <thead><tr><th>Lead</th><th>Event</th><th>Status</th><th>Retries</th><th>Last error</th><th>Sent</th></tr></thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td data-label="Lead">#{ev.lead_id}</td>
                  <td data-label="Event">{ev.event_name}</td>
                  <td data-label="Status"><span className={`badge ${CAPI_STATUS_BADGE[ev.status] || "badge-neutral"}`}>{CAPI_STATUS_LABEL[ev.status] || ev.status}</span></td>
                  <td data-label="Retries">{ev.retry_count}</td>
                  <td data-label="Last error" className="text-sm text-tertiary">{ev.last_error || "—"}</td>
                  <td data-label="Sent">{ev.sent_at ? formatDateTime(ev.sent_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MetaIntegration() {
  usePageTitle("Meta Lead Ads");
  const [searchParams, setSearchParams] = useSearchParams();
  const [customFields, setCustomFields] = useState([]);
  const [connection, setConnection] = useState(null);

  // §I: the OAuth callback (meta.controller.js oauthCallback) redirects the
  // browser back here with ?connected=true or ?error=... since it can't hand
  // results back any other way — surface it once, then strip the query
  // string so a reload doesn't re-show a stale toast.
  useEffect(() => {
    if (searchParams.get("connected") === "true") {
      toastSuccess("Meta account connected.");
      setSearchParams({}, { replace: true });
    } else if (searchParams.get("error")) {
      toastError(`Meta connection failed: ${searchParams.get("error")}`);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { customFields: fields } = await customFieldsApi.list();
        // GET /api/custom-fields returns every definition, active or not —
        // but a mapping's crm_field_key must resolve to an ACTIVE definition
        // (see metaFormFieldMappingService.assertValidCrmFieldKey), so an
        // inactive one is filtered out here rather than offered and rejected.
        setCustomFields(fields.filter((f) => f.is_active));
      } catch {
        setCustomFields([]);
      }
    })();
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Meta Lead Ads</h2>
          <p className="page-subtitle">Connect a Facebook Page to import Lead Ads submissions automatically. Not a full ad-management tool — just enough to get leads into the CRM.</p>
        </div>
      </div>
      <ConnectionCard onConnectionChange={setConnection} />
      <FormsCard connected={!!connection?.connected && !connection?.isExpired} customFields={customFields} />
      <div className="page-header">
        <div>
          <h3 className="page-title" style={{ fontSize: "1.1rem" }}>Conversions (Meta CAPI)</h3>
          <p className="page-subtitle">Sent automatically when a lead reaches a status marked "final" — not on lead creation.</p>
        </div>
      </div>
      <CapiCard />
    </>
  );
}
