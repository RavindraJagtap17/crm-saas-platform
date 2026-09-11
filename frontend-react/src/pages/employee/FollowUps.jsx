import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { followUpsApi } from "../../api/resources";
import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../layouts/PageTitleContext";
import DataTable from "../../components/DataTable";
import Pagination from "../../components/Pagination";
import { confirmDialog } from "../../components/confirmDialog";
import { toastSuccess, toastError } from "../../components/toast";
import { FollowUpStatusBadge } from "../../components/Badges";
import ScheduleFollowUpModal from "../../components/ScheduleFollowUpModal";
import { formatDateTime } from "../../utils/format";
import { refreshFollowUpIndicator } from "../../layouts/followUpIndicatorBus";

const VIEWS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due Today" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
const PAGE_SIZE = 20;

function buildQuery(view, page) {
  const q = { page, pageSize: PAGE_SIZE };
  if (view === "overdue") {
    q.overdue = "true";
  } else if (view === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    q.status = "pending";
    q.dateFrom = start.toISOString();
    q.dateTo = end.toISOString();
  } else if (view) {
    q.status = view;
  }
  return q;
}

export default function FollowUps() {
  usePageTitle("Follow-ups");
  const { user: currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const [view, setView] = useState(VIEWS.some((v) => v.value === requestedView) ? requestedView : "");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [listError, setListError] = useState(null);
  const [modal, setModal] = useState(null);

  const refresh = useCallback(async () => {
    setItems(null);
    try {
      const { items: rows, pagination: p } = await followUpsApi.list(buildQuery(view, page));
      setItems(rows);
      setPagination(p);
    } catch (err) {
      setListError(err.message);
    }
  }, [view, page]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openReschedule = (fu) => {
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

  const columns = [
    {
      key: "lead",
      label: "Lead",
      render: (fu) => (
        <>
          <a className="table-cell-primary" href={`/employee/leads/${fu.leadId}`}>{fu.leadName || "(no name)"}</a>
          <div className="table-cell-muted text-xs">{fu.leadPhone || ""}</div>
        </>
      ),
    },
    { key: "scheduled", label: "Scheduled", render: (fu) => <span className="text-sm">{formatDateTime(fu.scheduledAt)}</span> },
    { key: "status", label: "Status", render: (fu) => <FollowUpStatusBadge status={fu.status} isOverdue={fu.isOverdue} /> },
    { key: "notes", label: "Notes", render: (fu) => (fu.notes ? <span className="text-sm text-secondary">{fu.notes.length > 60 ? `${fu.notes.slice(0, 60)}…` : fu.notes}</span> : "—") },
    {
      key: "actions",
      label: "",
      render: (fu) =>
        fu.status === "pending" ? (
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => openReschedule(fu)}>Reschedule</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleComplete(fu)}>Complete</button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleCancel(fu)}>Cancel</button>
          </div>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Follow-ups</h2>
          <p className="page-subtitle">Your scheduled follow-ups — reschedule, complete, or cancel from here.</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body flex gap-3" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 160, marginBottom: 0 }}>
            <label className="label" htmlFor="f-view">View</label>
            <select className="select" id="f-view" value={view} onChange={(e) => { setView(e.target.value); setPage(1); }}>
              {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {listError ? (
        <p className="text-secondary">{listError}</p>
      ) : (
        <DataTable columns={columns} rows={items} empty={{ icon: "⏰", title: "No follow-ups match this view", desc: "Try a different filter, or check back once one is scheduled." }} />
      )}
      {pagination ? <Pagination {...pagination} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} /> : null}

      {modal ? (
        <ScheduleFollowUpModal open title={modal.title} currentUser={currentUser} defaults={modal.defaults} onClose={() => setModal(null)} onSubmit={modal.onSubmit} />
      ) : null}
    </>
  );
}
