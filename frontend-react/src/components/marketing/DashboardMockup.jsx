/**
 * An original representation of MEP's real dashboard aggregates — not a
 * screenshot, not real numbers. Structurally matches what the app's
 * dashboard service actually computes (see backend dashboardService.js):
 * lead totals, a monthly volume trend, a source breakdown, and a status
 * pipeline — but every value here is illustrative placeholder data.
 */
const BARS = [38, 52, 46, 61, 55, 70];
const SOURCES = [
  { label: "Website", pct: 42 },
  { label: "Meta", pct: 27 },
  { label: "Google Ads", pct: 18 },
  { label: "IndiaMART", pct: 13 },
];
const PIPELINE = [
  { label: "New", count: 24, tone: "new" },
  { label: "Interested", count: 16, tone: "progress" },
  { label: "Follow-up", count: 9, tone: "progress" },
  { label: "Won", count: 12, tone: "won" },
];

export default function DashboardMockup() {
  return (
    <figure className="mkt-browser" aria-hidden="true">
      <div className="mkt-browser-bar">
        <div className="mkt-browser-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="mkt-browser-url">app.mep.example / dashboard</div>
      </div>
      <div className="mkt-browser-body">
        <div className="mkt-dashmock">
          <div className="mkt-dashmock-stats">
            <div className="mkt-dashmock-stat">
              <span>Total Leads</span>
              <strong>312</strong>
            </div>
            <div className="mkt-dashmock-stat">
              <span>Unassigned</span>
              <strong>18</strong>
            </div>
            <div className="mkt-dashmock-stat">
              <span>Overdue Follow-ups</span>
              <strong>5</strong>
            </div>
          </div>

          <div className="mkt-dashmock-grid">
            <div className="mkt-dashmock-panel">
              <div className="mkt-dashmock-panel-title">Monthly Lead Volume</div>
              <div className="mkt-dashmock-bars">
                {BARS.map((h, i) => (
                  <span key={i} className="mkt-dashmock-bar" style={{ "--h": `${h}%` }} />
                ))}
              </div>
            </div>
            <div className="mkt-dashmock-panel">
              <div className="mkt-dashmock-panel-title">Source Breakdown</div>
              <div className="mkt-dashmock-sources">
                {SOURCES.map((s) => (
                  <div className="mkt-dashmock-source-row" key={s.label}>
                    <span>{s.label}</span>
                    <div className="mkt-dashmock-source-track">
                      <span style={{ width: `${s.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mkt-dashmock-panel">
            <div className="mkt-dashmock-panel-title">Pipeline by Status</div>
            <div className="mkt-dashmock-pipeline">
              {PIPELINE.map((p) => (
                <div className={`mkt-dashmock-pipe is-${p.tone}`} key={p.label}>
                  <strong>{p.count}</strong>
                  <span>{p.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
