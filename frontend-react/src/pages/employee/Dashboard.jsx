import { useEffect, useState } from "react";
import { dashboardApi, leadsApi, leadStatusesApi } from "../../api/resources";
import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../layouts/PageTitleContext";
import { EmptyState, ErrorState, SkeletonRows, SkeletonStatCards } from "../../components/States";
import { DuplicateBadge, StatusPill } from "../../components/Badges";

export default function Dashboard() {
  usePageTitle("Dashboard");
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [statuses, setStatuses] = useState(null);
  const [callingList, setCallingList] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [summaryData, statusData] = await Promise.all([dashboardApi.summary(), leadStatusesApi.list().then((r) => r.statuses)]);
        setSummary(summaryData);
        setStatuses(statusData);

        const finalStatusIds = new Set(statusData.filter((s) => s.is_final).map((s) => s.id));
        const { items } = await leadsApi.list({ pageSize: 100, assignedTo: user.id });
        setCallingList(items.filter((l) => !finalStatusIds.has(l.statusId)));
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [user.id]);

  if (error) return <ErrorState desc={error} />;
  if (!summary || !statuses) {
    return (
      <>
        <SkeletonStatCards count={6} />
        <div className="card mb-6"><div className="card-body"><SkeletonRows count={2} /></div></div>
      </>
    );
  }

  const { followUps } = summary;
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  return (
    <>
      <div className="grid-stats mb-6">
        <div className="card stat-card"><span className="stat-label">Assigned to you</span><span className="stat-value">{summary.totals.assigned}</span></div>
        <div className="card stat-card"><span className="stat-label">Today's Calls</span><span className="stat-value">{summary.totals.callsToday}</span><span className="stat-meta">{summary.totals.callsThisMonth} this month</span></div>
        <div className="card stat-card"><span className="stat-label">Today's Follow-ups</span><span className="stat-value">{followUps.todayCount}</span><span className="stat-meta">Due today</span></div>
        <div className="card stat-card"><span className="stat-label">Overdue Follow-ups</span><span className="stat-value">{followUps.overdueCount}</span><span className="stat-meta">Past due, still pending</span></div>
        <div className="card stat-card"><span className="stat-label">Upcoming Follow-ups</span><span className="stat-value">{followUps.upcomingCount}</span></div>
        <div className="card stat-card"><span className="stat-label">Completed Today</span><span className="stat-value">{followUps.completedTodayCount}</span></div>
      </div>

      <div className="card mb-6">
        <div className="card-header">
          <h2 className="card-title">My Leads by Status</h2>
          <p className="card-subtitle">Only leads assigned to you.</p>
        </div>
        <div className="card-body">
          {summary.statusBreakdown.length ? (
            <div className="flex gap-3" style={{ flexWrap: "wrap" }}>
              {summary.statusBreakdown.map((s) => (
                <div key={s.status_id ?? s.name} className="badge badge-neutral" style={{ height: "auto", padding: "var(--space-2) var(--space-3)" }}>
                  {s.name}
                  {s.isFinal ? " ·" : ""} <strong className="num">&nbsp;{s.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-secondary">No leads assigned to you yet.</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Today's Calling List</h2>
          <p className="card-subtitle">Your open leads, newest first.</p>
        </div>
        <div className="card-body">
          {callingList === null ? (
            <SkeletonRows count={2} />
          ) : !callingList.length ? (
            <EmptyState icon="☀" title="You're all caught up" desc="No open leads need your attention right now." />
          ) : (
            <ul className="flex-col gap-2">
              {callingList.map((l) => {
                const status = statusById.get(l.statusId);
                return (
                  <li key={l.id}>
                    <a href={`/employee/leads/${l.id}`} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-3) var(--space-4)", textDecoration: "none" }}>
                      <span>
                        <span className="table-cell-primary">{l.name || l.phone || "Untitled lead"}</span> <DuplicateBadge isDuplicate={l.isDuplicate} />
                        <div className="text-xs text-tertiary">{l.phone || ""}</div>
                      </span>
                      {status ? <StatusPill name={status.name} color={status.color} /> : <span className="text-tertiary text-xs">No status</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
