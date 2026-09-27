/**
 * An original, hand-built representation of MEP's real Leads screen —
 * not a screenshot. Structurally accurate to the actual page (search box,
 * status/source filters, a lead table with name/source/status/assigned-to
 * columns, pagination footer) but every row is illustrative placeholder
 * content, not real customer data. Deliberately does NOT show sortable
 * column headers — the real Leads list is not sortable by column, only
 * paginated in created-date order, so this mockup doesn't imply a
 * capability the product doesn't have.
 */
const ROWS = [
  { name: "Priya Sharma", meta: "98765 43210", source: "Website", status: "new", assigned: "Unassigned" },
  { name: "Arjun Mehta", meta: "meta lead ads", source: "Meta", status: "interested", assigned: "R. Iyer" },
  { name: "Kavya Nair", meta: "google ads", source: "Google Ads", status: "new", assigned: "Unassigned" },
  { name: "Devraj Singh", meta: "csv import", source: "IndiaMART", status: "follow-up", assigned: "S. Rao" },
];

const STATUS_LABEL = { new: "New", interested: "Interested", "follow-up": "Follow-up" };

export default function LeadsTableMockup() {
  return (
    <figure className="mkt-browser" aria-hidden="true">
      <div className="mkt-browser-bar">
        <div className="mkt-browser-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="mkt-browser-url">app.mep.example / leads</div>
      </div>
      <div className="mkt-browser-body">
        <div className="mkt-leadsmock">
          <div className="mkt-leadsmock-toolbar">
            <div className="mkt-leadsmock-search">Search leads…</div>
            <div className="mkt-leadsmock-filter">Status</div>
            <div className="mkt-leadsmock-filter">Source</div>
            <div className="mkt-leadsmock-filter">Assigned to</div>
          </div>
          <div className="mkt-leadsmock-table">
            <div className="mkt-leadsmock-head">
              <span>Lead</span>
              <span>Source</span>
              <span>Status</span>
              <span>Assigned</span>
            </div>
            {ROWS.map((row) => (
              <div className="mkt-leadsmock-row" key={row.name}>
                <span className="mkt-leadsmock-lead">
                  <span className="mkt-mock-avatar" aria-hidden="true" />
                  <span>
                    <strong>{row.name}</strong>
                    <em>{row.meta}</em>
                  </span>
                </span>
                <span>{row.source}</span>
                <span className={`mkt-leadsmock-pill is-${row.status}`}>{STATUS_LABEL[row.status]}</span>
                <span className="mkt-leadsmock-assignee">{row.assigned}</span>
              </div>
            ))}
          </div>
          <div className="mkt-leadsmock-footer">
            <span>Showing 1–4 of 128</span>
            <span className="mkt-leadsmock-page">Page 1 of 32</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
