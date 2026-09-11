import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { linkedinApi, customFieldsApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { confirmDialog } from "../../components/confirmDialog";
import { toastSuccess, toastError } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";
import { formatDateTime } from "../../utils/format";

// §F/§I: CRM field keys a mapping may point to are either one of these
// three fixed core fields or one of the Client's own active custom field
// definitions — identical set to Meta's own mapping form.
const CORE_FIELDS = [
  { key: "name", label: "Name (core)" },
  { key: "phone", label: "Phone (core)" },
  { key: "email", label: "Email (core)" },
];

const OWNER_TYPES = [
  { key: "organization", label: "Organization (Company Page)" },
  { key: "sponsoredAccount", label: "Sponsored (Ad) Account" },
];

// Backend error `code` values (linkedinLeadFormService.js) mapped to
// plain-language explanations — never shown as a raw code/stack to the
// Client Admin, never anything that could be a credential.
const ERROR_MESSAGES = {
  missing_params: "LinkedIn didn't return the expected authorization details. Please try connecting again.",
  LINKEDIN_STATE_INVALID: "This connection link expired or was already used. Please start over.",
  LINKEDIN_SUBSCRIPTION_FAILED: "LinkedIn accepted the sign-in but rejected the lead notification setup. Check that this account has Lead Sync API access, then try again.",
  LINKEDIN_OAUTH_ERROR: "LinkedIn couldn't complete the sign-in. Please try again.",
  LINKEDIN_UNREACHABLE: "Couldn't reach LinkedIn. Please try again shortly.",
  LINKEDIN_NOT_CONFIGURED: "LinkedIn integration isn't configured on this server yet. Contact support.",
  connection_failed: "The connection to LinkedIn failed. Please try again.",
  access_denied: "LinkedIn sign-in was cancelled.",
};
function friendlyOAuthError(code) {
  return ERROR_MESSAGES[code] || `LinkedIn connection failed (${code}). Please try again.`;
}

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
  const [externalFieldKey, setExternalFieldKey] = useState(mapping?.external_field_key || "");
  const [crmFieldKey, setCrmFieldKey] = useState(mapping?.crm_field_key || CORE_FIELDS[0].key);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      if (isEdit) {
        await linkedinApi.updateMapping(mapping.id, { crmFieldKey });
      } else {
        const key = externalFieldKey.trim();
        if (!key) throw new Error("Enter the LinkedIn question ID.");
        await linkedinApi.createMapping({ externalFormId: formId, externalFieldKey: key, crmFieldKey });
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
          <label className="label" htmlFor="lm-question-id">LinkedIn question ID</label>
          <input
            className="input"
            id="lm-question-id"
            value={externalFieldKey}
            placeholder="e.g. 1"
            disabled={isEdit}
            onChange={(e) => setExternalFieldKey(e.target.value)}
          />
          <span className="hint">The numeric Question ID LinkedIn sends for this form's answer — not the question's display text. Check Recent Events below for a real example after a test submission, or the form's details in LinkedIn Campaign Manager.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="lm-crm-key">CRM field</label>
          <CrmFieldSelect id="lm-crm-key" value={crmFieldKey} onChange={setCrmFieldKey} customFields={customFields} />
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
      const { mappings: m } = await linkedinApi.mappings(formId);
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
      message: "New leads from this form will drop this question instead of storing it, until you add a new mapping.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await linkedinApi.removeMapping(id);
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
                desc="Map this form's LinkedIn question IDs to CRM fields. Any question left unmapped is dropped when a lead comes in — never stored, and never blocks the lead from being created."
              />
            ) : (
              <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
                <table className="data-table">
                  <thead><tr><th>Question ID</th><th>CRM field</th><th></th></tr></thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m.id}>
                        <td data-label="Question ID" className="table-cell-primary">{m.external_field_key}</td>
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

const FORM_STATE_BADGE = { PUBLISHED: "badge-success", DRAFT: "badge-neutral", ARCHIVED: "badge-neutral" };

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
          <EmptyState icon="▤" title="Connect LinkedIn first" desc="Form discovery and field mapping become available once a LinkedIn account is connected above." />
        </div>
      </div>
    );
  }

  const loadForms = async () => {
    setLoading(true);
    setError(null);
    setForms(null);
    try {
      const { forms: f } = await linkedinApi.forms();
      setForms(f);
    } catch (err) {
      // A LinkedIn-side failure here (expired/revoked authorization, or
      // LinkedIn unreachable) has no other visible signal anywhere else in
      // this UI — surface it plainly rather than leaving an empty list.
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
            <span className="label">LinkedIn Lead Gen Forms for this owner</span>
            <p className="text-tertiary text-sm">Field mappings are configured per form — load or pick a form to configure it.</p>
          </div>
          <LoadingButton className="btn btn-secondary btn-sm" loading={loading} onClick={loadForms}>Load forms</LoadingButton>
        </div>
        <div>
          {error ? (
            <EmptyState icon="⚠" title="Couldn't load forms" desc={error} />
          ) : forms === null ? null : !forms.length ? (
            <p className="text-tertiary text-sm">No Lead Gen Forms found for this owner yet.</p>
          ) : (
            forms.map((f) => (
              <button key={f.id} className="btn btn-secondary btn-sm mr-2 mb-2" onClick={() => setSelectedFormId(f.id)}>
                {f.name || f.id}
                {f.state ? <span className={`badge ${FORM_STATE_BADGE[f.state] || "badge-neutral"}`}> {f.state}</span> : null}
              </button>
            ))
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="manual-form-id">Or enter a LinkedIn form ID manually</label>
          <div className="flex gap-2">
            <input className="input" id="manual-form-id" placeholder="e.g. 6851219773716516864" style={{ flex: 1 }} value={manualFormId} onChange={(e) => setManualFormId(e.target.value)} />
            <button className="btn btn-secondary" onClick={useManualForm}>Use</button>
          </div>
        </div>
        {selectedFormId ? <MappingSection formId={selectedFormId} customFields={customFields} /> : null}
      </div>
    </div>
  );
}

function validateOwnerId(value) {
  return /^\d{1,32}$/.test(value.trim());
}

function OwnerForm({ ownerType, setOwnerType, ownerId, setOwnerId, error }) {
  return (
    <>
      <div className="field">
        <label className="label" htmlFor="li-owner-type">Owner type</label>
        <select className="select" id="li-owner-type" value={ownerType} onChange={(e) => setOwnerType(e.target.value)}>
          {OWNER_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <span className="hint">Whether the lead forms you want belong to a LinkedIn Company Page (Organization) or an advertising account (Sponsored/Ad Account).</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="li-owner-id">Owner ID</label>
        <input className="input" id="li-owner-id" value={ownerId} placeholder="e.g. 5509810" onChange={(e) => setOwnerId(e.target.value)} />
        <span className="hint">The numeric LinkedIn ID for that Company Page or ad account — find it in your Company Page admin URL (linkedin.com/company/&lt;id&gt;/admin) or in Campaign Manager's account settings. Not your page's vanity name or a campaign ID.</span>
      </div>
      {error ? <div className="field-error">{error}</div> : null}
    </>
  );
}

function ConnectionCard({ onConnectionChange }) {
  const [connection, setConnection] = useState(undefined);
  const [loadError, setLoadError] = useState(null);
  const [ownerType, setOwnerType] = useState(OWNER_TYPES[0].key);
  const [ownerId, setOwnerId] = useState("");
  const [ownerError, setOwnerError] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [reconnectOpen, setReconnectOpen] = useState(false);
  const [reconnectOwnerType, setReconnectOwnerType] = useState(OWNER_TYPES[0].key);
  const [reconnectOwnerId, setReconnectOwnerId] = useState("");
  const [reconnectError, setReconnectError] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const refresh = async () => {
    setConnection(undefined);
    setLoadError(null);
    try {
      const c = await linkedinApi.connection();
      setConnection(c);
      const cfg = c.config || {};
      setReconnectOwnerType(cfg.ownerType || OWNER_TYPES[0].key);
      setReconnectOwnerId(cfg.ownerId || "");
      onConnectionChange(c);
    } catch (err) {
      setLoadError(err.message);
      onConnectionChange(null);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startConnect = async (type, id, setError, setBusy) => {
    setError(null);
    if (!validateOwnerId(id)) {
      setError("Owner ID must be the numeric LinkedIn ID (digits only).");
      return;
    }
    setBusy(true);
    try {
      const { authorizationUrl } = await linkedinApi.connect(type, id.trim());
      // Full-page navigation to LinkedIn's OAuth dialog — same reasoning as
      // Meta's own connect flow (the Bearer token stays in the Authorization
      // header for the /connect call above, never in this URL).
      window.location.href = authorizationUrl;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: "Disconnect LinkedIn account?",
      message: "New Lead Gen Form submissions will stop being imported until you reconnect. Existing leads and field mappings are kept.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      await linkedinApi.disconnect();
      toastSuccess("LinkedIn account disconnected.");
      await refresh();
    } catch (err) {
      toastError(err.message);
    } finally {
      setDisconnecting(false);
    }
  };

  if (connection === undefined) {
    return (
      <div className="card mb-4">
        <div className="card-body">{loadError ? <EmptyState icon="⚠" title="Couldn't load connection status" desc={loadError} /> : <SkeletonRows count={1} />}</div>
      </div>
    );
  }

  if (!connection.connected) {
    return (
      <div className="card mb-4">
        <div className="card-body flex-col gap-4">
          <EmptyState icon="◫" title="No LinkedIn account connected" desc="Connect a LinkedIn Company Page or ad account to start receiving Lead Gen Form submissions automatically." />
          <div>
            <OwnerForm ownerType={ownerType} setOwnerType={setOwnerType} ownerId={ownerId} setOwnerId={setOwnerId} error={ownerError} />
          </div>
          <LoadingButton className="btn btn-primary" loading={connecting} onClick={() => startConnect(ownerType, ownerId, setOwnerError, setConnecting)}>
            Connect LinkedIn
          </LoadingButton>
        </div>
      </div>
    );
  }

  const cfg = connection.config || {};
  const ownerTypeLabel = OWNER_TYPES.find((t) => t.key === cfg.ownerType)?.label || cfg.ownerType || "—";

  return (
    <div className="card mb-4">
      <div className="card-body flex-col gap-4">
        <div className="field-row">
          <div>
            <span className="label">Owner type</span>
            <p>{ownerTypeLabel}</p>
          </div>
          <div>
            <span className="label">Owner ID</span>
            <p>{cfg.ownerId || "—"}</p>
          </div>
          <div>
            <span className="label">Lead type</span>
            <p>{cfg.leadType || "—"}</p>
          </div>
          <div>
            <span className="label">Webhook</span>
            <p><span className={`badge ${cfg.webhookValidated ? "badge-success" : "badge-warning"}`}>{cfg.webhookValidated ? "Verified by LinkedIn" : "Awaiting LinkedIn's verification (~2h)"}</span></p>
          </div>
          <div>
            <span className="label">Status</span>
            <p><span className="badge badge-success">Connected</span></p>
          </div>
        </div>
        <div className="flex gap-3">
          <button className="btn btn-secondary" onClick={() => setReconnectOpen((o) => !o)}>Reconnect</button>
          <LoadingButton className="btn btn-secondary" loading={disconnecting} onClick={disconnect}>Disconnect</LoadingButton>
        </div>
        {reconnectOpen ? (
          <div>
            <div className="divider" />
            <p className="text-tertiary text-sm mb-3">Re-authorize with LinkedIn — useful if leads have stopped arriving, or to point this connection at a different Company Page or ad account. Your existing field mappings are kept either way.</p>
            <OwnerForm ownerType={reconnectOwnerType} setOwnerType={setReconnectOwnerType} ownerId={reconnectOwnerId} setOwnerId={setReconnectOwnerId} error={reconnectError} />
            <LoadingButton className="btn btn-primary" loading={reconnecting} onClick={() => startConnect(reconnectOwnerType, reconnectOwnerId, setReconnectError, setReconnecting)}>
              Start reconnect
            </LoadingButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const EVENT_STATUS_BADGE = {
  received: "badge-neutral",
  processing: "badge-neutral",
  processed: "badge-success",
  duplicate: "badge-neutral",
  failed: "badge-danger",
};
const EVENT_STATUS_LABEL = {
  received: "Received",
  processing: "Processing",
  processed: "Processed",
  duplicate: "Duplicate",
  failed: "Failed",
};

// Integration event recovery & operational hardening — a Client Admin
// should be able to tell "stuck or repeatedly failing" apart from
// "normal" without database access (attempts/nextAttemptAt were already
// returned by the API; this is the first place either is actually shown).
// A 'received' row with attempts > 0 was reset by the stale-processing
// sweep after getting stuck — not a fabricated status, just surfacing
// what already happened.
function eventStatusDetail(ev) {
  if (ev.status === "failed" && ev.attempts) {
    const next = ev.nextAttemptAt ? `, next retry ${formatDateTime(ev.nextAttemptAt)}` : "";
    return ` (${ev.attempts} attempt${ev.attempts === 1 ? "" : "s"}${next})`;
  }
  if (ev.status === "received" && ev.attempts) {
    return ` (recovered — ${ev.attempts} prior attempt${ev.attempts === 1 ? "" : "s"})`;
  }
  return "";
}

function EventsCard() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { events: e } = await linkedinApi.events(50);
        setEvents(e);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  return (
    <div className="card">
      {error ? (
        <div className="card-body"><EmptyState icon="⚠" title="Couldn't load recent events" desc={error} /></div>
      ) : events === null ? (
        <div className="card-body"><SkeletonRows count={1} /></div>
      ) : !events.length ? (
        <div className="card-body">
          <EmptyState icon="⇪" title="No LinkedIn events yet" desc="When LinkedIn delivers a Lead Gen Form submission, it will show up here — whether it was successfully turned into a lead or not." />
        </div>
      ) : (
        <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="data-table">
            <thead><tr><th>Received</th><th>External lead ID</th><th>Status</th><th>CRM lead</th><th>Error</th></tr></thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td data-label="Received">{formatDateTime(ev.receivedAt)}</td>
                  <td data-label="External lead ID">
                    <code className="text-sm" title={ev.externalLeadId}>
                      {ev.externalLeadId.length > 40 ? `${ev.externalLeadId.slice(0, 40)}…` : ev.externalLeadId}
                    </code>
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${EVENT_STATUS_BADGE[ev.status] || "badge-neutral"}`}>{EVENT_STATUS_LABEL[ev.status] || ev.status}</span>
                    <span className="text-tertiary text-sm">{eventStatusDetail(ev)}</span>
                  </td>
                  <td data-label="CRM lead">{ev.crmLeadId ? <a href={`/admin/leads/${ev.crmLeadId}`}>#{ev.crmLeadId}</a> : "—"}</td>
                  <td data-label="Error" className="text-sm text-tertiary">{ev.lastError || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function LinkedinIntegration() {
  usePageTitle("LinkedIn Lead Gen Forms");
  const [searchParams, setSearchParams] = useSearchParams();
  const [customFields, setCustomFields] = useState([]);
  const [connection, setConnection] = useState(null);

  // The OAuth callback (linkedinLeadForm.controller.js oauthCallback)
  // redirects the browser back here with ?connected=true or ?error=...
  // since it can't hand results back any other way — surface it once,
  // then strip the query string so a reload doesn't re-show a stale toast.
  useEffect(() => {
    if (searchParams.get("connected") === "true") {
      toastSuccess("LinkedIn account connected.");
      setSearchParams({}, { replace: true });
    } else if (searchParams.get("error")) {
      toastError(friendlyOAuthError(searchParams.get("error")));
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { customFields: fields } = await customFieldsApi.list();
        // A mapping's crm_field_key must resolve to an ACTIVE definition (see
        // integrationFieldMappingService.assertValidCrmFieldKey) — an inactive
        // one is filtered out here rather than offered and rejected.
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
          <h2 className="page-title">LinkedIn Lead Gen Forms</h2>
          <p className="page-subtitle">Connect a LinkedIn Company Page or ad account to import Lead Gen Form submissions automatically. Not a full ad-management tool — just enough to get leads into the CRM.</p>
        </div>
      </div>
      <ConnectionCard onConnectionChange={setConnection} />
      <FormsCard connected={!!connection?.connected} customFields={customFields} />
      <div className="page-header">
        <div>
          <h3 className="page-title" style={{ fontSize: "1.1rem" }}>Recent events</h3>
          <p className="page-subtitle">Every Lead Gen Form submission LinkedIn has delivered, whether it became a lead or not.</p>
        </div>
      </div>
      <EventsCard />
    </>
  );
}
