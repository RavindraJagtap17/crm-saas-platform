import Reveal from "./Reveal";
import Card3D from "./Card3D";
import { IconLeads, IconSources, IconAssign, IconFollowUp, IconAnalytics, IconClients, IconPalette } from "./icons";

const FEATURES = [
  {
    icon: IconLeads,
    title: "Lead Management",
    desc: "Keep every lead organized in one place and give your team a clear workspace to manage the lead lifecycle.",
  },
  {
    icon: IconSources,
    title: "Multiple Lead Sources",
    desc: "Bring leads in from Meta, Google Ads, LinkedIn, IndiaMART, embedded web forms, or a CSV import.",
  },
  {
    icon: IconAssign,
    title: "Lead Assignment",
    desc: "Assign leads to the right team members and keep ownership clear.",
  },
  {
    icon: IconFollowUp,
    title: "Follow-ups",
    desc: "Keep your team on top of every opportunity with organized follow-up workflows.",
  },
  {
    icon: IconAnalytics,
    title: "Analytics & Dashboard",
    desc: "Understand your lead pipeline and monitor activity from a centralized dashboard.",
  },
  {
    icon: IconClients,
    title: "Agency Operations",
    desc: "Manage every client's leads and team from one agency account, kept cleanly separate underneath.",
  },
  {
    icon: IconPalette,
    title: "Workspace Branding",
    desc: "Set your agency's name, logo, and brand color across your and your clients' workspaces.",
  },
];

export default function FeatureGrid() {
  return (
    <section className="mkt-section mkt-dark-section is-alt" id="capabilities">
      <div className="mkt-container">
        <div className="mkt-section-head">
          <Reveal as="h2" className="mkt-h2">
            Everything your agency needs to run leads.
          </Reveal>
          <Reveal as="p" className="mkt-lead" delay={80}>
            Built around the core workflow every agency already runs — capture, organize, assign, follow up, convert.
          </Reveal>
        </div>

        <div className="mkt-grid-3">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <Reveal as="div" className="mkt-3d-slot" key={title} delay={i * 60}>
              <Card3D className="mkt-card">
                <div className="mkt-card-icon" data-depth="3">
                  <Icon aria-hidden="true" />
                </div>
                <h3 data-depth="2">{title}</h3>
                <p data-depth="1">{desc}</p>
              </Card3D>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
