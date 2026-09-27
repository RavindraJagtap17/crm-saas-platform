import { useState } from "react";
import Reveal from "./Reveal";
import LeadsTableMockup from "./LeadsTableMockup";
import FollowUpMockup from "./FollowUpMockup";
import DashboardMockup from "./DashboardMockup";
import CellBand from "./CellBand";

const TABS = [
  {
    key: "leads",
    label: "Leads",
    copy: "Search, filter, and manage every lead from one workspace.",
    Visual: LeadsTableMockup,
  },
  {
    key: "follow-ups",
    label: "Follow-ups",
    copy: "See what's overdue, due today, and coming up next.",
    Visual: FollowUpMockup,
  },
  {
    key: "dashboard",
    label: "Dashboard",
    copy: "Pipeline, sources, and volume — at a glance.",
    Visual: DashboardMockup,
  },
];

export default function ProductShowcase() {
  const [active, setActive] = useState("leads");
  const activeTab = TABS.find((t) => t.key === active);
  const Visual = activeTab.Visual;

  return (
    <section className="mkt-section mkt-dark-section mkt-showcase-section">
      <CellBand variant="dark" />
      <div className="mkt-container">
        <div className="mkt-section-head">
          <Reveal as="div" className="mkt-eyebrow">
            Inside MEP
          </Reveal>
          <Reveal as="h2" className="mkt-h2" delay={40}>
            Everything your team needs. Right where you need it.
          </Reveal>
        </div>

        <div className="mkt-showcase-tabs" role="tablist" aria-label="Product areas">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active === tab.key}
              className={`mkt-showcase-tab ${active === tab.key ? "is-active" : ""}`}
              onClick={() => setActive(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="mkt-showcase-caption">{activeTab.copy}</p>

        <Reveal className="mkt-hero-visual" key={active}>
          <Visual />
        </Reveal>
      </div>
    </section>
  );
}
