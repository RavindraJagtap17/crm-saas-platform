/**
 * An original representation of MEP's real follow-up list — not a
 * screenshot. Matches the actual data model (a scheduled date/time, a
 * free-text note, an assignee, and a derived overdue/today/upcoming
 * state) — illustrative placeholder content only.
 */
const ITEMS = [
  { name: "Priya Sharma", note: "Confirm budget and timeline", when: "Today, 3:00 PM", state: "today" },
  { name: "Arjun Mehta", note: "Send updated proposal", when: "Yesterday, 11:00 AM", state: "overdue" },
  { name: "Kavya Nair", note: "Intro call follow-up", when: "Tomorrow, 10:30 AM", state: "upcoming" },
];

const STATE_LABEL = { today: "Due today", overdue: "Overdue", upcoming: "Upcoming" };

export default function FollowUpMockup() {
  return (
    <figure className="mkt-browser" aria-hidden="true">
      <div className="mkt-browser-bar">
        <div className="mkt-browser-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="mkt-browser-url">app.mep.example / follow-ups</div>
      </div>
      <div className="mkt-browser-body">
        <div className="mkt-followmock">
          {ITEMS.map((item) => (
            <div className="mkt-followmock-row" key={item.name}>
              <span className="mkt-mock-avatar" aria-hidden="true" />
              <div className="mkt-followmock-body">
                <strong>{item.name}</strong>
                <span>{item.note}</span>
              </div>
              <div className="mkt-followmock-when">
                <span className={`mkt-followmock-pill is-${item.state}`}>{STATE_LABEL[item.state]}</span>
                <em>{item.when}</em>
              </div>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
