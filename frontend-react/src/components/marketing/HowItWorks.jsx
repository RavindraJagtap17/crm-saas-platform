import Reveal from "./Reveal";

const STEPS = [
  { number: "01", title: "Connect", desc: "Connect your lead sources." },
  { number: "02", title: "Capture", desc: "Bring new leads into MEP." },
  { number: "03", title: "Manage", desc: "Assign, organize and follow up with your team." },
  { number: "04", title: "Convert", desc: "Turn more opportunities into customers." },
];

export default function HowItWorks() {
  return (
    <section className="mkt-section">
      <div className="mkt-container">
        <div className="mkt-section-head">
          <Reveal as="h2" className="mkt-h2">
            How MEP works
          </Reveal>
        </div>

        <div className="mkt-steps">
          {STEPS.map((step, i) => (
            <Reveal as="div" className="mkt-step" key={step.number} delay={i * 90}>
              <span className="mkt-step-number">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
