import Reveal from "./Reveal";
import { IconLeads, IconSources, IconAssign, IconFollowUp, IconAnalytics, IconWebForm, IconCsv } from "./icons";

const FEATURES = [
  {
    icon: IconLeads,
    title: "Lead Management",
    desc: "Keep every lead organized in one place and give your team a clear workspace to manage the lead lifecycle.",
  },
  {
    icon: IconSources,
    title: "Multiple Lead Sources",
    desc: "Bring leads from the platforms and channels your clients already use.",
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
    icon: IconWebForm,
    title: "Web Forms",
    desc: "Capture leads directly from websites and send them into MEP.",
  },
  {
    icon: IconCsv,
    title: "CSV Import",
    desc: "Move existing lead data into MEP quickly with structured CSV importing.",
  },
];

export default function FeatureGrid() {
  return (
    <section className="mkt-section mkt-section-alt" id="capabilities">
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
            <Reveal as="article" className="mkt-card" key={title} delay={i * 60}>
              <div className="mkt-card-icon">
                <Icon aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
