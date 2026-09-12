import { Link } from "react-router-dom";
import { useDocumentMeta } from "../../utils/useDocumentMeta";
import Reveal from "../../components/marketing/Reveal";
import { IconCheck } from "../../components/marketing/icons";

/**
 * Final pricing hasn't been set yet — every plan below routes to Contact
 * rather than showing an invented number. Feature lists only include
 * capabilities that exist today (see Features.jsx's own audit trail) and
 * are differentiated along axes the product already supports: number of
 * clients an agency manages, and which lead sources are connected. No
 * white-labeling, no support-tier language, and no capability that isn't
 * in the current codebase.
 */
const PLANS = [
  {
    name: "Starter",
    desc: "For agencies just getting their lead operations organized.",
    featured: false,
    features: [
      "Core lead management (CRUD, search, filters, sorting)",
      "One client workspace",
      "Web forms and CSV import",
      "Follow-up scheduling",
    ],
  },
  {
    name: "Professional",
    desc: "For established agencies managing several clients at once.",
    featured: true,
    features: [
      "Everything in Starter",
      "Multiple client workspaces",
      "Bulk lead actions and assignment",
      "Meta, Google Ads, LinkedIn, and IndiaMART lead sources",
      "Custom fields per client",
    ],
  },
  {
    name: "Enterprise",
    desc: "For agencies with larger, more complex client portfolios.",
    featured: false,
    features: [
      "Everything in Professional",
      "Higher client and team volume",
      "Agency-wide visibility across every client",
    ],
  },
];

export default function Pricing() {
  useDocumentMeta({
    title: "Pricing",
    description: "MEP plans for agencies of every size. Pricing is tailored to your agency — talk to sales to get started.",
  });

  return (
    <>
      <section className="mkt-section">
        <div className="mkt-container">
          <div className="mkt-section-head">
            <Reveal as="div" className="mkt-eyebrow">
              Pricing
            </Reveal>
            <Reveal as="h1" className="mkt-h1" style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)" }} delay={60}>
              Plans built around how your agency grows.
            </Reveal>
            <Reveal as="p" className="mkt-lead" delay={120}>
              Pricing is tailored to your agency&apos;s size and needs. Talk to us to find the right plan.
            </Reveal>
          </div>

          <div className="mkt-pricing-grid">
            {PLANS.map((plan, i) => (
              <Reveal as="div" className={`mkt-pricing-card ${plan.featured ? "is-featured" : ""}`} key={plan.name} delay={i * 80}>
                {plan.featured ? <span className="mkt-pricing-badge">Most popular</span> : null}
                <div>
                  <div className="mkt-pricing-name">{plan.name}</div>
                  <p className="mkt-pricing-desc">{plan.desc}</p>
                </div>
                <div className="mkt-pricing-price">
                  Custom <span>/ pricing</span>
                </div>
                <ul className="mkt-pricing-list">
                  {plan.features.map((f) => (
                    <li key={f}>
                      <IconCheck aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/contact" className={`btn ${plan.featured ? "btn-primary" : "btn-secondary"} w-full`}>
                  Talk to Sales
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-section-tight mkt-section-alt">
        <div className="mkt-container" style={{ textAlign: "center" }}>
          <p className="mkt-lead" style={{ margin: "0 auto" }}>
            Not sure which plan fits? <Link to="/contact" style={{ color: "var(--brand-600)", fontWeight: "var(--weight-semibold)" }}>Talk to sales</Link> and
            we&apos;ll help you figure it out.
          </p>
        </div>
      </section>
    </>
  );
}
