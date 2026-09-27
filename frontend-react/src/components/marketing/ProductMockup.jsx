/**
 * An original, hand-built representation of the MEP workspace — not a
 * screenshot, and not real data. Every label, row, and value here is
 * illustrative placeholder content shown purely to demonstrate the shape
 * of the product (a lead table with statuses, at-a-glance stats, and a
 * nav rail), the same way a wireframe or product-marketing composition
 * would. Built entirely from this app's own CSS tokens so it never needs
 * an image asset and stays crisp at any size.
 */
const ROWS = [
  { name: "Lead A", source: "Website", status: "new" },
  { name: "Lead B", source: "Meta", status: "progress" },
  { name: "Lead C", source: "Referral", status: "won" },
  { name: "Lead D", source: "Google Ads", status: "progress" },
];

export default function ProductMockup({ caption }) {
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
        <div className="mkt-mock-shell">
          <div className="mkt-mock-nav">
            <div className="mkt-mock-nav-item is-active" />
            <div className="mkt-mock-nav-item" />
            <div className="mkt-mock-nav-item" />
            <div className="mkt-mock-nav-item" />
          </div>
          <div className="mkt-mock-main">
            <div className="mkt-mock-stats">
              <div className="mkt-mock-stat">
                <div className="mkt-mock-stat-label" />
                <div className="mkt-mock-stat-value" />
              </div>
              <div className="mkt-mock-stat">
                <div className="mkt-mock-stat-label" />
                <div className="mkt-mock-stat-value" />
              </div>
              <div className="mkt-mock-stat">
                <div className="mkt-mock-stat-label" />
                <div className="mkt-mock-stat-value" />
              </div>
            </div>
            <div className="mkt-mock-table">
              {ROWS.map((row) => (
                <div className="mkt-mock-row" key={row.name}>
                  <div className="mkt-mock-avatar" />
                  <div className="mkt-mock-line" />
                  <span className={`mkt-mock-pill is-${row.status}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {caption ? <figcaption className="mkt-mock-caption">{caption}</figcaption> : null}
    </figure>
  );
}
