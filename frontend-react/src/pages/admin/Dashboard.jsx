import { useEffect, useState } from "react";
import { dashboardApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import { ErrorState, SkeletonRows, SkeletonStatCards } from "../../components/States";
import { EmptyState } from "../../components/States";
import { BarList, ColumnChart } from "../../components/Chart";
import { FollowUpStatusBadge } from "../../components/Badges";
import { formatMonthLabel, formatDateTime } from "../../utils/format";

const STAT_CARDS = 9;

export default function Dashboard() {
  usePageTitle("Dashboard");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setError(null);
    setData(null);
    try {
      setData(await dashboardApi.summary());
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorState desc={error} onRetry={load} />;
  if (!data) {
    return (
      <>
        <SkeletonStatCards count={STAT_CARDS} />
        <div className="card"><div className="card-body"><SkeletonRows count={4} /></div></div>
      </>
    );
  }

  const { totals, sourceBreakdown, monthlyVolume, statusBreakdown, followUps, todayFollowUps } = data;
  const nonZeroSources = sourceBreakdown.filter((s) => s.count > 0);

  return (
    <>
      <div className="grid-stats mb-6">
        <div className="card stat-card"><span className="stat-label">Total Leads</span><span className="stat-value">{totals.total}</span></div>
        <div className="card stat-card"><span className="stat-label">Today's Leads</span><span className="stat-value">{totals.todayCount}</span><span className="stat-meta">New today</span></div>
        <div className="card stat-card"><span className="stat-label">Yesterday's Leads</span><span className="stat-value">{totals.yesterdayCount}</span></div>
        <div className="card stat-card"><span className="stat-label">Unassigned</span><span className="stat-value">{totals.unassigned}</span><span className="stat-meta">Waiting to be assigned</span></div>
        <div className="card stat-card"><span className="stat-label">Duplicates Flagged</span><span className="stat-value">{totals.duplicates}</span></div>
        <div className="card stat-card"><span className="stat-label">Today's Follow-ups</span><span className="stat-value">{followUps.todayCount}</span><span className="stat-meta">Due today</span></div>
        <div className="card stat-card"><span className="stat-label">Overdue Follow-ups</span><span className="stat-value">{followUps.overdueCount}</span><span className="stat-meta">Past due, still pending</span></div>
        <div className="card stat-card"><span className="stat-label">Upcoming Follow-ups</span><span className="stat-value">{followUps.upcomingCount}</span></div>
        <div className="card stat-card"><span className="stat-label">Completed Today</span><span className="stat-value">{followUps.completedTodayCount}</span></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: "var(--space-6)" }}>
        <div className="card">
          <div className="card-header"><h2 className="card-title">Monthly Lead Volume</h2></div>
          <div className="card-body scroll-x">
            {monthlyVolume.length ? (
              <ColumnChart points={monthlyVolume.map((m) => ({ label: formatMonthLabel(m.month), count: m.count }))} labelKey="label" valueKey="count" />
            ) : (
              <p className="text-secondary">No leads yet — volume will appear here once leads start coming in.</p>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h2 className="card-title">Source Breakdown</h2></div>
          <div className="card-body">
            {nonZeroSources.length ? <BarList items={nonZeroSources} labelKey="name" valueKey="count" /> : <p className="text-secondary">No leads tagged with a source yet.</p>}
          </div>
        </div>
      </div>

      <div className="card mt-6">
        <div className="card-header">
          <h2 className="card-title">Pipeline by Status</h2>
          <p className="card-subtitle">Where every lead currently stands.</p>
        </div>
        <div className="card-body">
          {statusBreakdown.length ? (
            <div className="flex gap-3" style={{ flexWrap: "wrap" }}>
              {statusBreakdown.map((s) => (
                <div key={s.status_id ?? s.name} className="badge badge-neutral" style={{ height: "auto", padding: "var(--space-2) var(--space-3)" }}>
                  {s.name}
                  {s.isFinal ? " ·" : ""} <strong className="num">&nbsp;{s.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-secondary">
              No lead statuses configured yet. <a href="/admin/statuses">Set up your pipeline</a>.
            </p>
          )}
        </div>
      </div>

      <div className="card mt-6">
        <div className="card-header">
          <h2 className="card-title">Today's Follow-ups</h2>
          <p className="card-subtitle">Every follow-up due today, across the team.</p>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {todayFollowUps.length ? (
            <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
              <table className="data-table">
                <thead><tr><th>Lead</th><th>Assigned To</th><th>Date/Time</th><th>Status</th></tr></thead>
                <tbody>
                  {todayFollowUps.map((f) => (
                    <tr key={f.id}>
                      <td data-label="Lead"><a href={`/admin/leads/${f.leadId}`}>{f.leadName || f.leadPhone || `Lead #${f.leadId}`}</a></td>
                      <td data-label="Assigned To">{f.assignedToName || "—"}</td>
                      <td data-label="Date/Time">{formatDateTime(f.scheduledAt)}</td>
                      <td data-label="Status"><FollowUpStatusBadge status={f.status} isOverdue={new Date(f.scheduledAt).getTime() < Date.now()} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card-body"><EmptyState icon="☀" title="Nothing due today" /></div>
          )}
        </div>
      </div>
    </>
  );
}
