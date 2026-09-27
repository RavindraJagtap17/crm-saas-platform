import { Link } from "react-router-dom";
import { useDocumentMeta } from "../../utils/useDocumentMeta";
import Reveal from "../../components/marketing/Reveal";
import CTASection from "../../components/marketing/CTASection";
import { IconAssign, IconSources, IconCheck } from "../../components/marketing/icons";

const CLIENTS = ["Client A", "Client B", "Client C"];

function AgencyHierarchyVisual() {
  return (
    <Reveal className="mkt-hierarchy" delay={120} aria-hidden="true">
      <div className="mkt-hierarchy-root">Your Agency</div>
      <div className="mkt-flow-arrow" />
      <div className="mkt-hierarchy-clients">
        {CLIENTS.map((client) => (
          <div className="mkt-hierarchy-client" key={client}>
            <div className="mkt-hierarchy-client-name">{client}</div>
            <div className="mkt-hierarchy-client-row">Leads · Team · Follow-ups</div>
          </div>
        ))}
      </div>
      <div className="mkt-flow-arrow" />
      <div className="mkt-hierarchy-agency">Agency-wide dashboard</div>
    </Reveal>
  );
}

function SolutionSection({ id, eyebrow, title, desc, points, primary, Icon, visual }) {
  return (
    <section
      id={id}
      className={`mkt-section mkt-dark-section ${primary ? "" : "is-alt"}`}
      style={{ scrollMarginTop: "96px" }}
    >
      <div className="mkt-container mkt-grid-2" style={{ alignItems: "center", gap: "var(--space-10)" }}>
        <Reveal>
          <div className="mkt-eyebrow" style={{ marginBottom: "var(--space-3)" }}>
            {eyebrow}
          </div>
          <h2 className="mkt-h2" style={{ marginBottom: "var(--space-4)" }}>
            {title}
          </h2>
          <p className="mkt-lead" style={{ marginBottom: "var(--space-6)" }}>
            {desc}
          </p>
          <ul style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", listStyle: "none", padding: 0, margin: 0 }}>
            {points.map((point) => (
              <li key={point} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
                <IconCheck aria-hidden="true" style={{ color: "var(--color-success)", flexShrink: 0, marginTop: 2, width: 18, height: 18 }} />
                <span className="mkt-muted" style={{ fontSize: "var(--text-sm)" }}>{point}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        {visual || (
          <Reveal delay={120} className="mkt-card" style={{ padding: "var(--space-8)", textAlign: "center" }}>
            <div className="mkt-card-icon" style={{ margin: "0 auto var(--space-4)" }}>
              <Icon aria-hidden="true" />
            </div>
            <p className="mkt-muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>
              Every client&apos;s leads, sources, and team stay in their own workspace — nothing crosses over between clients.
            </p>
          </Reveal>
        )}
      </div>
    </section>
  );
}

export default function Solutions() {
  useDocumentMeta({
    title: "Solutions",
    description: "How MEP supports agencies, sales teams, and marketing teams managing client lead operations.",
  });

  return (
    <>
      <section className="mkt-section-tight mkt-dark-section is-alt">
        <div className="mkt-container mkt-section-head">
          <Reveal as="div" className="mkt-eyebrow">
            Solutions
          </Reveal>
          <Reveal as="h1" className="mkt-h1" style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)" }} delay={60}>
            Built around how agencies actually run leads.
          </Reveal>
        </div>
      </section>

      <SolutionSection
        id="for-agencies"
        eyebrow="For Agencies"
        title="One workspace for every client's lead operations."
        desc="MEP is built primarily for agencies managing leads on behalf of multiple clients — keep every client's pipeline, sources, and team organized without switching tools."
        points={[
          "Manage multiple clients from a single agency account",
          "Keep each client's leads and lead sources separate",
          "Assign team members within a client's workspace",
          "See activity and follow-ups across every client",
          "Set your agency's name, logo, and brand color across every workspace",
        ]}
        primary
        visual={<AgencyHierarchyVisual />}
      />

      <div id="client-lead-management" style={{ scrollMarginTop: "96px" }} />

      <SolutionSection
        id="for-sales-teams"
        eyebrow="For Sales Teams"
        title="Give your team a clear queue of what to work next."
        desc="Existing MEP functionality — assignment, status, and follow-ups — gives a sales team ownership and a clear next action on every lead."
        points={[
          "Leads assigned directly to the right team member",
          "A status pipeline that reflects where each lead really is",
          "Scheduled follow-ups so nothing is forgotten",
        ]}
        Icon={IconAssign}
      />

      <SolutionSection
        id="for-marketing-teams"
        eyebrow="For Marketing Teams"
        title="Get every captured lead into one place, automatically."
        desc="Connect the lead sources you already run campaigns on, or embed a web form, and new leads land directly in MEP — ready to be assigned and worked."
        points={[
          "Meta, Google Ads, LinkedIn, and IndiaMART lead sources",
          "Embeddable website forms with CSV import for existing lists",
          "Custom fields so campaign-specific details aren't lost",
        ]}
        Icon={IconSources}
        primary
      />

      <section className="mkt-section-tight mkt-dark-section is-alt">
        <div className="mkt-container" style={{ textAlign: "center" }}>
          <p className="mkt-lead" style={{ margin: "0 auto" }}>
            See the full capability list on the{" "}
            <Link to="/features" style={{ color: "#c4b5fd", fontWeight: "var(--weight-semibold)" }}>
              Features
            </Link>{" "}
            page.
          </p>
        </div>
      </section>

      <CTASection />
    </>
  );
}
