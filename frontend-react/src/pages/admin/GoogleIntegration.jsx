import { useEffect, useState } from "react";
import { googleAdsApi, customFieldsApi } from "../../api/resources";
import { API_BASE_URL } from "../../api/client";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { confirmDialog } from "../../components/confirmDialog";
import { toastSuccess, toastError } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";
import { formatDateTime } from "../../utils/format";

// §F/§I: CRM field keys a mapping may point to are either one of these
// three fixed core fields or one of the Client's own active custom field
// definitions — identical set to Meta's/LinkedIn's own mapping forms.
const CORE_FIELDS = [
  { key: "name", label: "Name (core)" },
  { key: "phone", label: "Phone (core)" },
  { key: "email", label: "Email (core)" },
];

async function copyToClipboard(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    toastError("Couldn't copy — select and copy the value manually.");
    return false;
  }
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  const click = async () => {
    if (await copyToClipboard(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return <button className="btn btn-secondary" onClick={click}>{copied ? "Copied!" : "Copy"}</button>;
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
        await googleAdsApi.updateMapping(mapping.id, { crmFieldKey });
      } else {
        const key = externalFieldKey.trim();
        if (!key) throw new Error("Enter the Google column ID.");
        await googleAdsApi.createMapping({ externalFormId: formId, externalFieldKey: key, crmFieldKey });
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
          <label className="label" htmlFor="gm-column-id">Google column ID</label>
          <input
            className="input"
            id="gm-column-id"
            value={externalFieldKey}
            placeholder="e.g. FULL_NAME or a custom question's column_id"
            disabled={isEdit}
            onChange={(e) => setExternalFieldKey(e.target.value)}
          />
          <span className="hint">The raw column_id Google sends for this field — check a real test submission (Recent Events below) or the field name shown when you built the lead form in Google Ads.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="gm-crm-key">CRM field</label>
          <CrmFieldSelect id="gm-crm-key" value={crmFieldKey} onChange={setCrmFieldKey} customFields={customFields} />
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
      const { mappings: m } = await googleAdsApi.mappings(formId);
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
      message: "New leads from this form will drop this column instead of storing it, until you add a new mapping.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await googleAdsApi.removeMapping(id);
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
                desc="Map this form's Google column IDs to CRM fields. Any column left unmapped is dropped when a lead comes in — never stored, and never blocks the lead from being created."
              />
            ) : (
              <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
                <table className="data-table">
                  <thead><tr><th>Column ID</th><th>CRM field</th><th></th></tr></thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m.id}>
                        <td data-label="Column ID" className="table-cell-primary">{m.external_field_key}</td>
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
  const [manualFormId, setManualFormId] = useState("");
  const [selectedFormId, setSelectedFormId] = useState(null);

  if (!connected) {
    return (
      <div className="card mb-4">
        <div className="card-body">
          <EmptyState icon="▤" title="Connect Google Ads first" desc="Field mapping becomes available once a Google Ads webhook is connected above." />
        </div>
      </div>
    );
  }

  const useManualForm = () => {
    const id = manualFormId.trim();
    if (!id) return;
    setSelectedFormId(id);
  };

  return (
    <div className="card mb-4">
      <div className="card-body flex-col gap-4">
        <div>
          <span className="label">Field mapping</span>
          <p className="text-tertiary text-sm">Google's Lead Form webhook doesn't offer a way to list your forms from here — enter the numeric form ID from Google Ads (Ads &amp; assets → Lead form assets) to configure its mapping.</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="manual-form-id">Google form ID</label>
          <div className="flex gap-2">
            <input className="input" id="manual-form-id" placeholder="e.g. 12345678901" style={{ flex: 1 }} value={manualFormId} onChange={(e) => setManualFormId(e.target.value)} />
            <button className="btn btn-secondary" onClick={useManualForm}>Use</button>
          </div>
        </div>
        {selectedFormId ? <MappingSection formId={selectedFormId} customFields={customFields} /> : null}
      </div>
    </div>
  );
}

// Shown exactly once, immediately after a successful connect/regenerate —
// the plaintext key is never retrievable again afterward (getConnection
// never decrypts it back out, see googleLeadFormService.getConnection).
function CredentialsReveal({ webhookUrl, webhookKey, onDone }) {
  return (
    <div className="card-body flex-col gap-4">
      <div className="alert alert-warning">
        <span>⚠</span>
        <span>Save this key now — it will not be shown again. Paste both values into Google Ads under Ads &amp; assets → Lead form assets → Webhook delivery for each form you want to send leads from.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="reveal-webhook-url">Webhook URL</label>
        <div className="flex gap-2">
          <input className="input" id="reveal-webhook-url" value={webhookUrl} readOnly style={{ flex: 1 }} />
          <CopyButton value={webhookUrl} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="reveal-webhook-key">Webhook key</label>
        <div className="flex gap-2">
          <input className="input" id="reveal-webhook-key" value={webhookKey} readOnly style={{ flex: 1 }} />
          <CopyButton value={webhookKey} />
        </div>
      </div>
      <button className="btn btn-primary" onClick={onDone}>I&apos;ve saved these — done</button>
    </div>
  );
}

function ConnectionCard({ onConnectionChange }) {
  const [connection, setConnection] = useState(undefined);
  const [loadError, setLoadError] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [revealCreds, setRevealCreds] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const refresh = async () => {
    setConnection(undefined);
    setLoadError(null);
    try {
      const c = await googleAdsApi.connection();
      setConnection(c);
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

  const runConnect = async () => {
    setConnecting(true);
    try {
      const result = await googleAdsApi.connect();
      setRevealCreds(result);
    } catch (err) {
      toastError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const regenerate = async () => {
    const ok = await confirmDialog({
      title: "Regenerate webhook credentials?",
      message: "This immediately invalidates the current webhook URL and key — Google will no longer be able to deliver leads until you update every lead form in Google Ads with the new values. Existing field mappings are kept.",
      confirmLabel: "Regenerate",
      danger: true,
    });
    if (!ok) return;
    await runConnect();
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: "Disconnect Google Ads?",
      message: "New Lead Form submissions will stop being imported until you reconnect. Existing leads and field mappings are kept.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      await googleAdsApi.disconnect();
      toastSuccess("Google Ads webhook disconnected.");
      await refresh();
    } catch (err) {
      toastError(err.message);
    } finally {
      setDisconnecting(false);
    }
  };

  const doneReveal = async () => {
    setRevealCreds(null);
    await refresh();
  };

  if (revealCreds) {
    return (
      <div className="card mb-4">
        <CredentialsReveal webhookUrl={revealCreds.webhookUrl} webhookKey={revealCreds.webhookKey} onDone={doneReveal} />
      </div>
    );
  }

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
          <EmptyState
            icon="▧"
            title="No Google Ads webhook connected"
            desc="Connecting mints a webhook URL and a secret key for this Client — you'll paste both into Google Ads yourself, per lead form, to start receiving submissions."
          />
          <LoadingButton className="btn btn-primary" loading={connecting} onClick={runConnect}>Connect Google Ads</LoadingButton>
        </div>
      </div>
    );
  }

  // externalAccountId is an opaque routing token, not a secret — it's
  // embedded in the (public) webhook URL itself, so reconstructing and
  // showing that URL again on every load is safe. The key itself is
  // never re-shown; see CredentialsReveal's own comment.
  const webhookUrl = `${API_BASE_URL}/api/integrations/google/webhook/${connection.externalAccountId}`;

  return (
    <div className="card mb-4">
      <div className="card-body flex-col gap-4">
        <div className="field-row">
          <div>
            <span className="label">Status</span>
            <p><span className="badge badge-success">Connected</span></p>
          </div>
          <div>
            <span className="label">Connected</span>
            <p>{formatDateTime(connection.connectedAt)}</p>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="conn-webhook-url">Webhook URL</label>
          <div className="flex gap-2">
            <input className="input" id="conn-webhook-url" value={webhookUrl} readOnly style={{ flex: 1 }} />
            <CopyButton value={webhookUrl} />
          </div>
          <span className="hint">The webhook key isn't shown here — it was only ever displayed once, right after connecting. If it's lost or may have leaked, regenerate below (this replaces both values and requires updating Google Ads again).</span>
        </div>
        <div className="flex gap-3">
          <button className="btn btn-secondary" onClick={regenerate}>Regenerate credentials</button>
          <LoadingButton className="btn btn-secondary" loading={disconnecting} onClick={disconnect}>Disconnect</LoadingButton>
        </div>
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
        const { events: e } = await googleAdsApi.events(50);
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
          <EmptyState icon="⇪" title="No Google Ads events yet" desc="When Google delivers a Lead Form submission, it will show up here — whether it was successfully turned into a lead or not." />
        </div>
      ) : (
        <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="data-table">
            <thead><tr><th>Received</th><th>External lead ID</th><th>Status</th><th>CRM lead</th><th>Error</th></tr></thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td data-label="Received">{formatDateTime(ev.receivedAt)}</td>
                  <td data-label="External lead ID"><code className="text-sm">{ev.externalLeadId}</code></td>
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

export default function GoogleIntegration() {
  usePageTitle("Google Ads Lead Forms");
  const [customFields, setCustomFields] = useState([]);
  const [connection, setConnection] = useState(null);

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
          <h2 className="page-title">Google Ads Lead Forms</h2>
          <p className="page-subtitle">Connect Google Ads' Lead Form webhook to import submissions automatically. Not a full ad-management tool — just enough to get leads into the CRM.</p>
        </div>
      </div>
      <ConnectionCard onConnectionChange={setConnection} />
      <FormsCard connected={!!connection?.connected} customFields={customFields} />
      <div className="page-header">
        <div>
          <h3 className="page-title" style={{ fontSize: "1.1rem" }}>Recent events</h3>
          <p className="page-subtitle">Every Lead Form submission Google has delivered, whether it became a lead or not.</p>
        </div>
      </div>
      <EventsCard />
    </>
  );
}
