import { useCallback, useEffect, useState } from "react";
import { followUpsApi, leadsApi } from "../api/resources";
import { confirmDialog } from "./confirmDialog";
import { toastSuccess, toastError } from "./toast";
import { formatDateTime } from "../utils/format";
import { FollowUpStatusBadge } from "./Badges";
import { EmptyState } from "./States";
import ScheduleFollowUpModal from "./ScheduleFollowUpModal";
import { refreshFollowUpIndicator } from "../layouts/followUpIndicatorBus";

function FollowUpItem({ fu, onReschedule, onComplete, onCancel }) {
  return (
    <div className="card" style={{ padding: "var(--space-3) var(--space-4)" }}>
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="font-semibold text-sm">{formatDateTime(fu.scheduledAt)}</div>
          <div className="text-xs text-tertiary mt-1">Assigned to {fu.assignedToName || "—"}</div>
          {fu.notes ? <p className="text-sm mt-2" style={{ color: "var(--text-primary)" }}>{fu.notes}</p> : null}
        </div>
        <FollowUpStatusBadge status={fu.status} isOverdue={fu.isOverdue} />
      </div>
      {fu.status === "pending" ? (
        <div className="flex gap-2 mt-3">
          <button className="btn btn-secondary btn-sm" onClick={() => onReschedule(fu)}>Reschedule</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onComplete(fu)}>Complete</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onCancel(fu)}>Cancel</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Lead detail page's "Follow-ups" card — ported from the old frontend's
 * components/followUpPanel.js renderFollowUpPanel(). `assignableUsers` is
 * only passed for a Client Admin; omit it for a Client Employee, whose
 * every follow-up here is implicitly their own (server-enforced too).
 */
export default function FollowUpPanel({ leadId, currentUser, assignableUsers }) {
  const [items, setItems] = useState(null);
  const [modal, setModal] = useState(null); // { title, defaults, onSubmit } | null

  const refresh = useCallback(async () => {
    try {
      const { items: rows } = await followUpsApi.list({ leadId });
      setItems(rows);
    } catch (err) {
      setItems({ error: err.message });
    }
  }, [leadId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openSchedule = (fu) => {
    setModal({
      title: "Reschedule follow-up",
      defaults: fu,
      onSubmit: async (body) => {
        await followUpsApi.update(fu.id, body);
        toastSuccess("Follow-up rescheduled.");
        setModal(null);
        await refresh();
        refreshFollowUpIndicator();
      },
    });
  };

  const openScheduleNew = () => {
    setModal({
      title: "Schedule follow-up",
      defaults: null,
      onSubmit: async (body) => {
        await leadsApi.createFollowUp(leadId, body);
        toastSuccess("Follow-up scheduled.");
        setModal(null);
        await refresh();
        refreshFollowUpIndicator();
      },
    });
  };

  const handleComplete = async (fu) => {
    const ok = await confirmDialog({ title: "Mark this follow-up complete?", message: "This records it as done and logs it on the lead's activity timeline.", confirmLabel: "Complete" });
    if (!ok) return;
    try {
      await followUpsApi.complete(fu.id);
      toastSuccess("Follow-up completed.");
      await refresh();
      refreshFollowUpIndicator();
    } catch (err) {
      toastError(err.message);
    }
  };

  const handleCancel = async (fu) => {
    const ok = await confirmDialog({ title: "Cancel this follow-up?", message: "This cannot be undone.", confirmLabel: "Cancel follow-up", danger: true });
    if (!ok) return;
    try {
      await followUpsApi.cancel(fu.id);
      toastSuccess("Follow-up cancelled.");
      await refresh();
      refreshFollowUpIndicator();
    } catch (err) {
      toastError(err.message);
    }
  };

  if (items === null) {
    return (
      <>
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" style={{ width: "70%" }} />
      </>
    );
  }
  if (items.error) return <p className="text-secondary">{items.error}</p>;

  const pending = items.filter((f) => f.status === "pending").sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const next = pending[0] || null;
  const history = items.filter((f) => f.id !== next?.id);

  return (
    <>
      <button className="btn btn-primary btn-sm mb-3" onClick={openScheduleNew}>+ Schedule Follow-up</button>
      {!items.length ? (
        <EmptyState icon="⏰" title="No follow-ups scheduled" desc="Schedule one to keep this lead moving." />
      ) : (
        <>
          {next ? (
            <div className="mb-3">
              <span className="label">Next follow-up</span>
              <div className="mt-2">
                <FollowUpItem fu={next} onReschedule={openSchedule} onComplete={handleComplete} onCancel={handleCancel} />
              </div>
            </div>
          ) : null}
          {history.length ? (
            <div>
              <span className="label">{next ? "History" : "Follow-ups"}</span>
              <div className="flex-col gap-2 mt-2">
                {history.map((f) => (
                  <FollowUpItem key={f.id} fu={f} onReschedule={openSchedule} onComplete={handleComplete} onCancel={handleCancel} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
      {modal ? (
        <ScheduleFollowUpModal
          open
          title={modal.title}
          currentUser={currentUser}
          assignableUsers={assignableUsers}
          defaults={modal.defaults}
          onClose={() => setModal(null)}
          onSubmit={modal.onSubmit}
        />
      ) : null}
    </>
  );
}
