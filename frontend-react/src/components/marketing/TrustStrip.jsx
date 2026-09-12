import Reveal from "./Reveal";
import { IconLeads, IconSources, IconAssign, IconFollowUp, IconAnalytics, IconClients } from "./icons";

/**
 * Deliberately capability names, not invented customer counts or logos —
 * "Trusted by 10,000+ agencies" would need a real number this project
 * doesn't have.
 */
const ITEMS = [
  { icon: IconLeads, label: "Lead Management" },
  { icon: IconSources, label: "Lead Capture" },
  { icon: IconAssign, label: "Assignment" },
  { icon: IconFollowUp, label: "Follow-ups" },
  { icon: IconAnalytics, label: "Analytics" },
  { icon: IconClients, label: "Client Management" },
];

export default function TrustStrip() {
  return (
    <section className="mkt-strip">
      <Reveal className="mkt-container mkt-strip-row">
        {ITEMS.map(({ icon: Icon, label }) => (
          <span className="mkt-strip-item" key={label}>
            <Icon aria-hidden="true" />
            {label}
          </span>
        ))}
      </Reveal>
    </section>
  );
}
