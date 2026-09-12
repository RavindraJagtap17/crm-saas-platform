import { useState } from "react";
import Reveal from "./Reveal";
import ProductMockup from "./ProductMockup";

const TABS = [
  { key: "manage", label: "Manage", copy: "Manage every lead with clarity." },
  { key: "track", label: "Track", copy: "Know what needs attention." },
  { key: "grow", label: "Grow", copy: "Turn your data into better decisions." },
];

export default function ProductShowcase() {
  const [active, setActive] = useState("manage");
  const activeTab = TABS.find((t) => t.key === active);

  return (
    <section className="mkt-section mkt-section-alt">
      <div className="mkt-container">
        <div className="mkt-section-head">
          <Reveal as="h2" className="mkt-h2">
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

        <Reveal className="mkt-hero-visual" style={{ marginBottom: "var(--space-6)" }} key={active}>
          <ProductMockup caption={activeTab.copy} />
        </Reveal>
      </div>
    </section>
  );
}
