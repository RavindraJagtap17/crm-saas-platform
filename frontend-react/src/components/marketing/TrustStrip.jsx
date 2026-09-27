import Reveal from "./Reveal";

/**
 * Deliberately factual, verifiable capability/scale statements — not
 * invented customer counts, logos, or "trusted by" claims. Each number
 * traces to something real in the product: 4 lead-source integrations
 * (Meta, Google Ads, LinkedIn, IndiaMART), 4 distinct roles with
 * server-enforced tenant isolation, no seat cap on team members, and the
 * three real capture paths (integrations, embeddable web forms, CSV).
 */
const STATS = [
  { value: "4", label: "Lead source integrations" },
  { value: "4", label: "Roles with isolated access" },
  { value: "Unlimited", label: "Team members per client" },
  { value: "3", label: "Ways to capture leads" },
];

export default function TrustStrip() {
  return (
    <section className="mkt-strip mkt-dark-section">
      <Reveal className="mkt-container mkt-strip-row">
        {STATS.map((s) => (
          <span className="mkt-strip-item" key={s.label}>
            <strong>{s.value}</strong>
            {s.label}
          </span>
        ))}
      </Reveal>
    </section>
  );
}
