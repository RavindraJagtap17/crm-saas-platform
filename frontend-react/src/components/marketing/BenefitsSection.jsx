import Reveal from "./Reveal";

const BENEFITS = [
  { title: "Less scattered data", desc: "Keep your agency's lead operations in one centralized workspace." },
  { title: "Faster response", desc: "Make it easier for your team to see and act on new leads." },
  { title: "Better client management", desc: "Keep each client's lead workflow organized and separate." },
  { title: "More visibility", desc: "Understand what's happening across your agency, at a glance." },
];

export default function BenefitsSection() {
  return (
    <section className="mkt-section mkt-dark-section is-alt">
      <div className="mkt-container">
        <div className="mkt-section-head is-left" style={{ maxWidth: 560, margin: "0 0 var(--space-10)" }}>
          <Reveal as="h2" className="mkt-h2">
            Outcomes, not just features.
          </Reveal>
        </div>

        <div className="mkt-outcomes">
          {BENEFITS.map((b, i) => (
            <Reveal as="div" className="mkt-outcome" key={b.title} delay={i * 70}>
              <span className="mkt-outcome-index">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{b.title}</h3>
                <p>{b.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
