import Reveal from "./Reveal";

const FLOW = [
  { label: "Website · Meta · Google Ads · LinkedIn · IndiaMART", kind: "sources" },
  { label: "MEP", kind: "core" },
  { label: "Centralized Leads", kind: "outcome" },
  { label: "Assignment", kind: "outcome" },
  { label: "Follow-ups", kind: "outcome" },
  { label: "Better Opportunity Management", kind: "outcome" },
];

export default function ValueProposition() {
  return (
    <section className="mkt-section">
      <div className="mkt-container">
        <div className="mkt-section-head">
          <Reveal as="h2" className="mkt-h2">
            One platform. Every lead. Every client.
          </Reveal>
          <Reveal as="p" className="mkt-lead" delay={80}>
            Stop managing leads across disconnected tools and spreadsheets. MEP brings your agency&apos;s lead
            operations into one centralized workspace.
          </Reveal>
        </div>

        <Reveal className="mkt-flow" delay={140}>
          {FLOW.map((node, i) => (
            <div key={node.label} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
              {i > 0 ? <div className="mkt-flow-arrow" /> : null}
              <div className={`mkt-flow-node is-${node.kind}`}>{node.label}</div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
