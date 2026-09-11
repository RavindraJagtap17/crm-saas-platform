import { useEffect, useState } from "react";
import { indiamartApi, customFieldsApi } from "../../api/resources";
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
// definitions — identical set to every other provider's mapping form.
const CORE_FIELDS = [
  { key: "name", label: "Name (core)" },
  { key: "phone", label: "Phone (core)" },
  { key: "email", label: "Email (core)" },
];

// The exact, fixed field set IndiaMART's Push API sends (confirmed against
// a real, literal sample payload during the discovery audit — see
// indiamartLeadFormService.js's own MAPPABLE_FIELD_KEYS, which this list
// mirrors exactly). Unlike Meta/Google/LinkedIn, IndiaMART's fields are a
// closed, known set rather than an admin-defined form schema, so this is
// offered as a select instead of a free-text "guess the raw key" input —
// a real UX improvement grounded in verified data, not a guess.
const INDIAMART_FIELDS = [
  { key: "SENDER_NAME", label: "Sender name" },
  { key: "SENDER_MOBILE", label: "Mobile" },
  { key: "SENDER_MOBILE_ALT", label: "Mobile (alternate)" },
  { key: "SENDER_EMAIL", label: "Email" },
  { key: "SENDER_EMAIL_ALT", label: "Email (alternate)" },
  { key: "SENDER_PHONE", label: "Phone (landline)" },
  { key: "SENDER_PHONE_ALT", label: "Phone (landline, alternate)" },
  { key: "SENDER_COMPANY", label: "Company" },
  { key: "SENDER_ADDRESS", label: "Address" },
  { key: "SENDER_CITY", label: "City" },
  { key: "SENDER_STATE", label: "State" },
  { key: "SENDER_PINCODE", label: "Pincode" },
  { key: "SENDER_COUNTRY_ISO", label: "Country (ISO code)" },
  { key: "SUBJECT", label: "Subject" },
  { key: "QUERY_PRODUCT_NAME", label: "Product name" },
  { key: "QUERY_MESSAGE", label: "Message" },
  { key: "QUERY_MCAT_NAME", label: "Product category" },
  { key: "CALL_DURATION", label: "Call duration (call enquiries only)" },
  { key: "RECEIVER_MOBILE", label: "Receiver mobile (call enquiries only)" },
];
function indiamartFieldLabel(key) {
  return INDIAMART_FIELDS.find((f) => f.key === key)?.label || key;
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

function MappingFormModal({ open, mapping, customFields, onClose, onSaved }) {
  const isEdit = !!mapping;
  const [externalFieldKey, setExternalFieldKey] = useState(mapping?.external_field_key || INDIAMART_FIELDS[0].key);
  const [crmFieldKey, setCrmFieldKey] = useState(mapping?.crm_field_key || CORE_FIELDS[0].key);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      if (isEdit) {
        await indiamartApi.updateMapping(mapping.id, { crmFieldKey });
      } else {
        // IndiaMART has no form concept — every mapping lives under the
        // one fixed "default" form id (see indiamartLeadFormService.js).
        await indiamartApi.createMapping({ externalFormId: "default", externalFieldKey, crmFieldKey });
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
          <label className="label" htmlFor="im-field-key">IndiaMART field</label>
          <select className="select" id="im-field-key" value={externalFieldKey} disabled={isEdit} onChange={(e) => setExternalFieldKey(e.target.value)}>
            {INDIAMART_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="im-crm-key">CRM field</label>
          <CrmFieldSelect id="im-crm-key" value={crmFieldKey} onChange={setCrmFieldKey} customFields={customFields} />
          <span className="hint">Core fields go straight onto the lead. Anything else is stored in custom fields — create it on the Custom Fields page first if it's missing here.</span>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

function MappingCard({ connected, customFields }) {
  const [mappings, setMappings] = useState(null);
  const [error, setError] = useState(null);
  const [modalMapping, setModalMapping] = useState(undefined);

  const refresh = async () => {
    setMappings(null);
    setError(null);
    try {
      const { mappings: m } = await indiamartApi.mappings();
      setMappings(m);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (connected) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  if (!connected) {
    return (
      <div className="card mb-4">
        <div className="card-body">
          <EmptyState icon="▤" title="Connect IndiaMART first" desc="Field mapping becomes available once an IndiaMART webhook is connected above." />
        </div>
      </div>
    );
  }

  const remove = async (id) => {
    const ok = await confirmDialog({
      title: "Remove this mapping?",
      message: "New leads will drop this field instead of storing it, until you add a new mapping.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await indiamartApi.removeMapping(id);
      toastSuccess("Mapping removed.");
      await refresh();
    } catch (err) {
      toastError(err.message);
    }
  };

  return (
    <div className="card mb-4">
      {error ? (
        <div className="card-body"><EmptyState icon="⚠" title="Couldn't load mappings" desc={error} /></div>
      ) : mappings === null ? (
        <div className="card-body"><SkeletonRows count={1} /></div>
      ) : (
        <div className="card-body flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="label">Field mapping</span>
              <p className="text-tertiary text-sm">IndiaMART's fields are fixed — map the ones you want onto your CRM fields below. There's no per-form setup here, unlike other providers: one mapping list covers every lead IndiaMART sends.</p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setModalMapping(null)}>+ Add mapping</button>
          </div>
          <div>
            {!mappings.length ? (
              <EmptyState
                icon="⇄"
                title="No field mappings yet"
                desc="Map IndiaMART's fields (sender name, mobile, email, and so on) to CRM fields. Any field left unmapped is dropped when a lead comes in — never stored, and never blocks the lead from being created."
              />
            ) : (
              <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
                <table className="data-table">
                  <thead><tr><th>IndiaMART field</th><th>CRM field</th><th></th></tr></thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m.id}>
                        <td data-label="IndiaMART field" className="table-cell-primary">{indiamartFieldLabel(m.external_field_key)}</td>
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
        </div>
      )}
      <MappingFormModal
        open={modalMapping !== undefined}
        mapping={modalMapping}
        customFields={customFields}
        onClose={() => setModalMapping(undefined)}
        onSaved={async () => { setModalMapping(undefined); await refresh(); }}
      />
    </div>
  );
}

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

function ConnectionCard({ onConnectionChange }) {
  const [connection, setConnection] = useState(undefined);
  const [loadError, setLoadError] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const refresh = async () => {
    setConnection(undefined);
    setLoadError(null);
    try {
      const c = await indiamartApi.connection();
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

  const runConnect = async (setBusy) => {
    setBusy(true);
    try {
      await indiamartApi.connect();
      toastSuccess("Webhook URL generated — one more step needed on IndiaMART's own dashboard (see below).");
      await refresh();
    } catch (err) {
      toastError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    const ok = await confirmDialog({
      title: "Regenerate webhook URL?",
      message: "This immediately invalidates the current URL — IndiaMART will no longer be able to deliver leads until you update the Push API setting on your IndiaMART dashboard with the new URL. Existing field mappings are kept.",
      confirmLabel: "Regenerate",
      danger: true,
    });
    if (!ok) return;
    await runConnect(setRegenerating);
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: "Disconnect IndiaMART?",
      message: "New leads will stop being imported until you reconnect and update the URL on IndiaMART's dashboard again. Existing leads and field mappings are kept.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      await indiamartApi.disconnect();
      toastSuccess("IndiaMART webhook disconnected.");
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
          <EmptyState
            icon="◨"
            title="No IndiaMART webhook connected"
            desc="Connecting mints a webhook URL for this Client. IndiaMART's Push API needs no key or credential — you'll register the URL yourself on your IndiaMART seller dashboard to finish setup."
          />
          <LoadingButton className="btn btn-primary" loading={connecting} onClick={() => runConnect(setConnecting)}>Connect IndiaMART</LoadingButton>
        </div>
      </div>
    );
  }

  // externalAccountId is the routing token minted for this connection —
  // not a secret in the way Google's shared key is (IndiaMART's Push API
  // has no key at all, see indiamartLeadFormService.js's own comment), so
  // it's safe to reconstruct and display on every load, unlike a credential.
  const webhookUrl = `${API_BASE_URL}/api/integrations/indiamart/webhook/${connection.externalAccountId}`;

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
        <div className="alert alert-warning">
          <span>⚠</span>
          <span>IndiaMART automatically deactivates this webhook if it goes 48 continuous hours without a successful delivery. If leads stop arriving, check Recent Events below for errors before assuming nothing's wrong.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="conn-webhook-url">Webhook URL</label>
          <div className="flex gap-2">
            <input className="input" id="conn-webhook-url" value={webhookUrl} readOnly style={{ flex: 1 }} />
            <CopyButton value={webhookUrl} />
          </div>
          <span className="hint">
            Finish setup on IndiaMART's side: log in at seller.indiamart.com → Lead Manager → the ⋮ menu → Push API (under Import/Export Leads) → choose your CRM platform, or "Other" if it's not listed → paste this URL → confirm the OTP sent to your account's registered mobile number.
          </span>
        </div>
        <div className="flex gap-3">
          <LoadingButton className="btn btn-secondary" loading={regenerating} onClick={regenerate}>Regenerate webhook URL</LoadingButton>
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
        const { events: e } = await indiamartApi.events(50);
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
          <EmptyState icon="⇪" title="No IndiaMART events yet" desc="When IndiaMART delivers an enquiry, it will show up here — whether it was successfully turned into a lead or not." />
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

export default function IndiamartIntegration() {
  usePageTitle("IndiaMART Leads");
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
          <h2 className="page-title">IndiaMART Leads</h2>
          <p className="page-subtitle">Connect IndiaMART's Push API to import buyer enquiries automatically. Not a full seller-dashboard replacement — just enough to get leads into the CRM.</p>
        </div>
      </div>
      <ConnectionCard onConnectionChange={setConnection} />
      <MappingCard connected={!!connection?.connected} customFields={customFields} />
      <div className="page-header">
        <div>
          <h3 className="page-title" style={{ fontSize: "1.1rem" }}>Recent events</h3>
          <p className="page-subtitle">Every enquiry IndiaMART has delivered, whether it became a lead or not.</p>
        </div>
      </div>
      <EventsCard />
    </>
  );
}
