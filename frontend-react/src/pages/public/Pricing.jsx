import { Link } from "react-router-dom";
import { useDocumentMeta } from "../../utils/useDocumentMeta";
import Reveal from "../../components/marketing/Reveal";
import { IconCheck } from "../../components/marketing/icons";

/**
 * Reflects the real billing model (backend/src/services/
 * clientLicenseService.js, clientLicensePriceService.js): agency signup is
 * free, and an agency pays one flat, platform-set price per client added,
 * licensed for 12 months and renewable. There are no tiered plans, so this
 * page shows exactly two cards — one per real billing unit — rather than
 * inventing a third. No final number exists yet, so the client license
 * shows "Custom" and both CTAs route to signup or Contact, not a checkout.
 */
const PLANS = [
  {
    name: "Agency account",
    desc: "Sign up, invite your team, and set up your agency workspace at no cost.",
    price: "Free",
    unit: null,
    cta: { label: "Get Started", to: "/auth/signup" },
    includesLabel: "Agency account includes",
    features: [
      "Sign up your agency",
      "Invite your team",
      "Set up your agency workspace",
      "No subscription, no card required",
    ],
  },
  {
    name: "Client license",
    desc: "Each client you add is licensed for 12 months, at one flat rate set by MEP — renew any time before it lapses.",
    price: "Custom",
    unit: "/ client / year",
    badge: "Per client",
    featured: true,
    cta: { label: "Talk to Sales", to: "/contact" },
    includesLabel: "Every client license includes",
    features: [
      "Unlimited team members per client",
      "Unlimited leads and lead sources",
      "Meta, Google Ads, LinkedIn, and IndiaMART integrations",
      "Embeddable web forms and CSV import",
      "Custom fields per client",
      "Workspace branding — your name, logo, and color",
    ],
  },
];

export default function Pricing() {
  useDocumentMeta({
    title: "Pricing",
    description: "MEP pricing for agencies: a free agency account and one license per client you manage. Talk to sales for current rates.",
  });

  return (
    <>
      <section className="mkt-section mkt-pricing-dark">
        <div className="mkt-container">
          <div className="mkt-section-head">
            <Reveal as="div" className="mkt-eyebrow">
              Pricing
            </Reveal>
            <Reveal as="h1" className="mkt-h1" style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)" }} delay={60}>
              Straightforward pricing for growing agencies.
            </Reveal>
            <Reveal as="p" className="mkt-lead" delay={120}>
              No feature-gated tiers. Your agency account is free — you only pay for the clients you actively manage.
            </Reveal>
          </div>

          <div className="mkt-plans">
            {PLANS.map((plan, i) => (
              <Reveal as="div" className="mkt-plan-slot" key={plan.name} delay={80 + i * 80}>
                <article className={`mkt-plan ${plan.featured ? "is-featured" : ""}`}>
                  {plan.badge ? <span className="mkt-plan-badge">{plan.badge}</span> : null}
                  <div className="mkt-plan-head">
                    <h2 className="mkt-plan-name">{plan.name}</h2>
                    <p className="mkt-plan-desc">{plan.desc}</p>
                  </div>
                  <div className="mkt-plan-body">
                    <div className="mkt-plan-price">
                      {plan.price}
                      {plan.unit ? <span>{plan.unit}</span> : null}
                    </div>
                    <Link to={plan.cta.to} className="mkt-plan-cta">
                      {plan.cta.label}
                    </Link>
                    <hr className="mkt-plan-divider" />
                    <p className="mkt-plan-includes">{plan.includesLabel}</p>
                    <ul className="mkt-plan-list">
                      {plan.features.map((f) => (
                        <li key={f}>
                          <span className="mkt-plan-check" aria-hidden="true">
                            <IconCheck />
                          </span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-section-tight mkt-pricing-dark">
        <div className="mkt-container" style={{ textAlign: "center" }}>
          <p className="mkt-lead" style={{ margin: "0 auto" }}>
            Questions about current rates or volume pricing?{" "}
            <Link to="/contact" className="mkt-pricing-link" style={{ fontWeight: "var(--weight-semibold)" }}>
              Talk to sales
            </Link>{" "}
            and we&apos;ll walk you through it.
          </p>
        </div>
      </section>
    </>
  );
}
