import Reveal from "./Reveal";
import { IconLeads, IconAssign, IconCheck } from "./icons";

const CLIENTS = ["Client A", "Client B", "Client C"];

const BENEFITS = [
  "Centralized management across every client",
  "Clear separation between each client's leads",
  "Organized, client-by-client lead operations",
  "Team assignment within each client workspace",
  "Agency-wide visibility across all of it",
];

export default function AgencySection() {
  return (
    <section className="mkt-section mkt-dark-section is-alt">
      <div className="mkt-container mkt-grid-2" style={{ alignItems: "center", gap: "var(--space-10)" }}>
        <Reveal>
          <h2 className="mkt-h2" style={{ marginBottom: "var(--space-4)" }}>
            Built for agencies. Not adapted for them.
          </h2>
          <p className="mkt-lead" style={{ marginBottom: "var(--space-6)" }}>
            Manage multiple clients, their leads, and their teams from a centralized agency workspace designed around
            the way modern agencies operate.
          </p>
          <ul style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", listStyle: "none", padding: 0, margin: 0 }}>
            {BENEFITS.map((benefit) => (
              <li key={benefit} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
                <IconCheck aria-hidden="true" style={{ color: "var(--color-success)", flexShrink: 0, marginTop: 2, width: 18, height: 18 }} />
                <span className="mkt-muted" style={{ fontSize: "var(--text-sm)" }}>{benefit}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="mkt-hierarchy" delay={120}>
          <div className="mkt-hierarchy-root">MEP</div>
          <div className="mkt-flow-arrow" />
          <div className="mkt-hierarchy-agency">Your Agency</div>
          <div className="mkt-flow-arrow" />
          <div className="mkt-hierarchy-clients">
            {CLIENTS.map((client) => (
              <div className="mkt-hierarchy-client" key={client}>
                <div className="mkt-hierarchy-client-name">{client}</div>
                <div className="mkt-hierarchy-client-row">
                  <IconLeads aria-hidden="true" />
                  Leads
                </div>
                <div className="mkt-hierarchy-client-row">
                  <IconAssign aria-hidden="true" />
                  Team
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
