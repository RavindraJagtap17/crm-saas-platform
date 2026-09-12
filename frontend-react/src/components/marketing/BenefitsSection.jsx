import Reveal from "./Reveal";

const BENEFITS = [
  { title: "Less scattered data", desc: "Keep your agency's lead operations in one centralized workspace." },
  { title: "Faster response", desc: "Make it easier for your team to see and act on new leads." },
  { title: "Better client management", desc: "Keep each client's lead workflow organized." },
  { title: "More visibility", desc: "Understand what's happening across your agency." },
  { title: "Easier scaling", desc: "Build a repeatable lead-management process as your agency grows." },
];

export default function BenefitsSection() {
  return (
    <section className="mkt-section mkt-section-alt">
      <div className="mkt-container">
        <div className="mkt-section-head">
          <Reveal as="h2" className="mkt-h2">
            Outcomes, not just features.
          </Reveal>
        </div>

        <div className="mkt-grid-3">
          {BENEFITS.map((b, i) => (
            <Reveal as="div" className="mkt-card" key={b.title} delay={i * 60}>
              <h3>{b.title}</h3>
              <p>{b.desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
