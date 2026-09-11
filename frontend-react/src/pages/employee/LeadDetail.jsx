import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { leadsApi, leadStatusesApi, leadSourcesApi, productsApi, customFieldsApi } from "../../api/resources";
import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess, toastError } from "../../components/toast";
import { EmptyState } from "../../components/States";
import { DuplicateBadge } from "../../components/Badges";
import LeadForm, { emptyLeadFormValue, leadFormValueToBody, fieldErrorsFromMessage } from "../../components/LeadForm";
import FollowUpPanel from "../../components/FollowUpPanel";
import { formatDateTime, relativeTime } from "../../utils/format";

const ACTIVITY_ICON = { call: "📞", note: "📝", assignment: "👤", follow_up: "⏰" };

function EditLeadModal({ open, lead, refData, onClose, onSaved }) {
  const [value, setValue] = useState(() => emptyLeadFormValue(lead));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setValue(emptyLeadFormValue(lead));
  }, [open, lead]);
  if (!open) return null;

  const submit = async () => {
    setErrors({});
    setSaving(true);
    try {
      await leadsApi.update(lead.id, leadFormValueToBody(value, refData.customFields));
      toastSuccess("Lead updated.");
      onSaved();
    } catch (err) {
      setErrors(fieldErrorsFromMessage(err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Edit lead"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>Save changes</LoadingButton>
        </>
      }
    >
      <LeadForm sources={refData.sources} products={refData.products} customFieldDefs={refData.customFields} value={value} onChange={setValue} fieldErrors={errors} />
    </Modal>
  );
}

export default function LeadDetail() {
  const { id: leadId } = useParams();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  usePageTitle("Lead");

  const [refData, setRefData] = useState(null);
  const [lead, setLead] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [activities, setActivities] = useState(null);
  const [statusValue, setStatusValue] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [actType, setActType] = useState("call");
  const [actOutcome, setActOutcome] = useState("");
  const [actRemarks, setActRemarks] = useState("");
  const [actError, setActError] = useState(null);
  const [actSaving, setActSaving] = useState(false);

  const reloadLead = useCallback(async () => {
    const { lead: fresh } = await leadsApi.get(leadId);
    setLead(fresh);
    setStatusValue(fresh.statusId || "");
    return fresh;
  }, [leadId]);

  const reloadActivities = useCallback(async () => {
    setActivities(null);
    try {
      const { activities: rows } = await leadsApi.activities(leadId);
      setActivities(rows);
    } catch (err) {
      setActivities({ error: err.message });
    }
  }, [leadId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statuses, sources, products, customFields] = await Promise.all([
          leadStatusesApi.list().then((r) => r.statuses),
          leadSourcesApi.list().then((r) => r.sources),
          productsApi.list().then((r) => r.products),
          customFieldsApi.list().then((r) => r.customFields),
        ]);
        if (cancelled) return;
        setRefData({ statuses, sources, products, customFields });
        await reloadLead();
        await reloadActivities();
      } catch (err) {
        if (!cancelled) setLoadError(err.status === 404 ? "This lead doesn't exist." : err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, reloadLead, reloadActivities]);

  const byId = (list, findId) => list.find((x) => String(x.id) === String(findId));

  const handleStatusSave = async () => {
    if (!statusValue) return toastError("Choose a status first.");
    setStatusSaving(true);
    try {
      await leadsApi.changeStatus(leadId, Number(statusValue));
      await reloadLead();
      toastSuccess("Status updated.");
    } catch (err) {
      toastError(err.message);
    } finally {
      setStatusSaving(false);
    }
  };

  const handleActivitySubmit = async (e) => {
    e.preventDefault();
    setActError(null);
    setActSaving(true);
    try {
      await leadsApi.addActivity(leadId, { type: actType, outcome: actOutcome.trim() || undefined, remarks: actRemarks.trim() || undefined });
      setActOutcome("");
      setActRemarks("");
      await reloadActivities();
      toastSuccess("Activity logged.");
    } catch (err) {
      setActError(err.message);
    } finally {
      setActSaving(false);
    }
  };

  if (loadError) return <EmptyState icon="⚠" title="Couldn't load this lead" desc={loadError} />;
  if (!refData || !lead) return null;

  const source = byId(refData.sources, lead.sourceId);
  const product = byId(refData.products, lead.productId);
  const customEntries = Object.entries(lead.customFields || {});

  return (
    <>
      <a href="/employee/leads" className="text-sm" onClick={(e) => { e.preventDefault(); navigate("/employee/leads"); }}>← Back to leads</a>
      <div className="page-header mt-2">
        <div>
          <h2 className="page-title">{lead.name || lead.phone || lead.email || `Lead #${lead.id}`}</h2>
          <p className="page-subtitle">{lead.isDuplicate ? <DuplicateBadge isDuplicate /> : `Lead #${lead.id}`}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setEditOpen(true)}>Edit</button>
      </div>

      {lead.isDuplicate ? (
        <div className="alert alert-warning mb-4">
          <span>⧉</span>
          <span>This lead shares a phone number with an earlier lead (lead #{lead.duplicateOfLeadId}).</span>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "var(--space-6)" }}>
        <div className="flex-col gap-6">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Details</h3></div>
            <div className="card-body">
              <div className="field-row mb-4">
                <div><span className="label">Name</span><div className="mt-2">{lead.name || "—"}</div></div>
                <div><span className="label">Phone</span><div className="mt-2">{lead.phone || "—"}</div></div>
              </div>
              <div className="field-row mb-4">
                <div><span className="label">Email</span><div className="mt-2">{lead.email || "—"}</div></div>
                <div><span className="label">Source</span><div className="mt-2">{source?.name || "—"}</div></div>
              </div>
              <div className="field-row mb-4">
                <div><span className="label">Product</span><div className="mt-2">{product?.name || "—"}</div></div>
                <div><span className="label">Created</span><div className="mt-2">{formatDateTime(lead.createdAt)}</div></div>
              </div>
              {customEntries.length ? (
                <>
                  <div className="divider" />
                  <span className="label">Custom fields</span>
                  <div className="field-row mt-2">
                    {customEntries.map(([k, val]) => {
                      const def = refData.customFields.find((d) => d.field_key === k);
                      return (
                        <div key={k}>
                          <span className="text-xs text-tertiary">{def?.label || k}</span>
                          <div>{String(val)}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">Activity timeline</h3></div>
            <div className="card-body">
              <form className="flex-col gap-3 mb-4" onSubmit={handleActivitySubmit}>
                <div className="field-row" style={{ alignItems: "end" }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="act-type">Type</label>
                    <select className="select" id="act-type" value={actType} onChange={(e) => setActType(e.target.value)}>
                      <option value="call">Call</option>
                      <option value="note">Note</option>
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="act-outcome">
                      Outcome <span className="optional">(optional)</span>
                    </label>
                    <input className="input" id="act-outcome" placeholder="e.g. Interested, No answer" value={actOutcome} onChange={(e) => setActOutcome(e.target.value)} />
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label" htmlFor="act-remarks">Remarks</label>
                  <textarea className="textarea" id="act-remarks" placeholder="What happened on this call?" value={actRemarks} onChange={(e) => setActRemarks(e.target.value)} />
                </div>
                {actError ? <div className="field-error">{actError}</div> : null}
                <LoadingButton className="btn btn-primary" style={{ alignSelf: "flex-end" }} loading={actSaving} type="submit">Log activity</LoadingButton>
              </form>
              <div className="divider" />
              {activities === null ? (
                <div className="skeleton skeleton-row" style={{ width: "70%" }} />
              ) : activities.error ? (
                <p className="text-secondary">{activities.error}</p>
              ) : !activities.length ? (
                <EmptyState icon="🕓" title="No activity yet" desc="Log a call or note above." />
              ) : (
                <ul className="flex-col gap-4">
                  {activities.slice().reverse().map((a) => (
                    <li key={a.id} className="flex gap-3">
                      <span aria-hidden="true">{ACTIVITY_ICON[a.type] || "•"}</span>
                      <div style={{ flex: 1 }}>
                        <div className="flex justify-between">
                          <span className="font-semibold text-sm">{a.user_name || "System"}</span>
                          <span className="text-xs text-tertiary" title={formatDateTime(a.created_at)}>{relativeTime(a.created_at)}</span>
                        </div>
                        {a.outcome ? <div className="text-xs"><span className="badge badge-info">{a.outcome}</span></div> : null}
                        {a.remarks ? <p className="text-sm mt-2" style={{ color: "var(--text-primary)" }}>{a.remarks}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="flex-col gap-6">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Pipeline</h3></div>
            <div className="card-body flex-col gap-4">
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label" htmlFor="status-select">Status</label>
                <select className="select" id="status-select" value={statusValue} onChange={(e) => setStatusValue(e.target.value)}>
                  <option value="">— No status —</option>
                  {refData.statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.is_final ? " (final)" : ""}</option>
                  ))}
                </select>
              </div>
              <LoadingButton className="btn btn-secondary btn-block" loading={statusSaving} onClick={handleStatusSave}>Update status</LoadingButton>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Follow-ups</h3>
              <p className="card-subtitle">Only follow-ups assigned to you.</p>
            </div>
            <div className="card-body">
              <FollowUpPanel leadId={leadId} currentUser={currentUser} />
            </div>
          </div>
        </div>
      </div>

      <EditLeadModal open={editOpen} lead={lead} refData={refData} onClose={() => setEditOpen(false)} onSaved={async () => { setEditOpen(false); await reloadLead(); }} />
    </>
  );
}
