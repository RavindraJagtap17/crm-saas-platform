import { Link } from "react-router-dom";
import { useDocumentMeta } from "../../utils/useDocumentMeta";
import Reveal from "../../components/marketing/Reveal";
import IntegrationsSection from "../../components/marketing/IntegrationsSection";
import CTASection from "../../components/marketing/CTASection";
import LeadsTableMockup from "../../components/marketing/LeadsTableMockup";
import WebFormMockup from "../../components/marketing/WebFormMockup";
import DashboardMockup from "../../components/marketing/DashboardMockup";
import { IconLeads, IconSources, IconClients, IconAnalytics, IconCheck } from "../../components/marketing/icons";

/**
 * Every capability listed below exists in the current application —
 * confirmed against a code-level audit of backend/src/services/leadService.js,
 * leadFollowUpService.js, leadImportService.js, the four lead-source
 * integration services, tenantService.js, and clientService.js. Two
 * things were deliberately removed from the previous version of this
 * page after that audit: "sort" (the Leads list has no column sorting —
 * only search, filter, and pagination) and a standalone "status history"
 * claim (every status change is recorded server-side, but there is no
 * screen in the product today that displays that history to a user, so
 * advertising it as a visible feature would overstate what a customer can
 * actually see).
 */
const GROUPS = [
  {
    id: "lead-management",
    icon: IconLeads,
    title: "Lead Management",
    desc: "Everything your team needs to work a lead from first contact to close.",
    items: [
      "Create, view, and edit leads",
      "Search across name, phone, and email",
      "Filter by status, source, product, and assigned owner",
      "Paginate through large lead lists",
      "Bulk assign or change the status of multiple leads at once",
      "Assign leads to specific team members",
      "Schedule and manage follow-ups per lead",
      "Log call notes and activity against a lead",
      "Automatic duplicate detection on matching phone numbers",
    ],
    Visual: LeadsTableMockup,
  },
  {
    id: "lead-capture",
    icon: IconSources,
    title: "Lead Capture",
    desc: "Bring leads in from the channels your clients already use.",
    items: [
      "Connect Meta Lead Ads, Google Ads Lead Forms, LinkedIn Lead Gen, and IndiaMART",
      "Embed a web form on any client site with a copy-paste snippet",
      "Import existing leads from a CSV file, with a preview step before confirming",
      "Download a CSV template that matches your lead fields",
    ],
    Visual: WebFormMockup,
  },
  {
    id: "agency-operations",
    icon: IconClients,
    title: "Agency Operations",
    desc: "Run every client's lead operations from one agency workspace.",
    items: [
      "Manage multiple clients from a single agency account",
      "Keep each client's leads, sources, and team separate",
      "Role-based access for agency admins, client admins, and team members",
      "Custom fields per client for the details your client's leads need",
      "Set your agency's name, logo, and brand color across every workspace",
    ],
  },
  {
    id: "analytics",
    icon: IconAnalytics,
    title: "Analytics",
    desc: "See what's happening across your pipeline without digging through spreadsheets.",
    items: [
      "A centralized dashboard for lead activity",
      "Monthly lead volume trends",
      "At-a-glance view of leads by status and source",
      "Follow-up visibility across your team",
    ],
    Visual: DashboardMockup,
  },
];

export default function Features() {
  useDocumentMeta({
    title: "Features",
    description: "Explore MEP's lead management, capture, agency operations, and analytics capabilities.",
  });

  return (
    <>
      <section className="mkt-section mkt-dark-section is-alt">
        <div className="mkt-container">
          <div className="mkt-section-head">
            <Reveal as="div" className="mkt-eyebrow">
              Features
            </Reveal>
            <Reveal as="h1" className="mkt-h1" style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)" }} delay={60}>
              A complete lead-management toolkit for agencies.
            </Reveal>
          </div>

          {GROUPS.map((group, gi) => (
            <div
              id={group.id}
              key={group.id}
              style={{ scrollMarginTop: "96px", marginBottom: gi < GROUPS.length - 1 ? "var(--space-16)" : 0 }}
            >
              <Reveal className="mkt-feature-group">
                <div>
                  <div className="mkt-card-icon" style={{ marginBottom: "var(--space-4)" }}>
                    <group.icon aria-hidden="true" />
                  </div>
                  <h2 className="mkt-h2" style={{ fontSize: "var(--text-2xl)", marginBottom: "var(--space-3)" }}>
                    {group.title}
                  </h2>
                  <p className="mkt-lead" style={{ fontSize: "var(--text-base)" }}>
                    {group.desc}
                  </p>
                </div>
                <ul className="mkt-feature-list">
                  {group.items.map((item) => (
                    <li key={item}>
                      <IconCheck aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
              {group.Visual ? (
                <Reveal className="mkt-feature-visual" delay={100}>
                  <group.Visual />
                </Reveal>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <IntegrationsSection />

      <section className="mkt-section-tight mkt-dark-section is-alt">
        <div className="mkt-container" style={{ textAlign: "center" }}>
          <p className="mkt-lead" style={{ margin: "0 auto" }}>
            Want to see how MEP fits your agency&apos;s workflow?{" "}
            <Link to="/solutions" style={{ color: "#c4b5fd", fontWeight: "var(--weight-semibold)" }}>
              Explore solutions
            </Link>
          </p>
        </div>
      </section>

      <CTASection />
    </>
  );
}
