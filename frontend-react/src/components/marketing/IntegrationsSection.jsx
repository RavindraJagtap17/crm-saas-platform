import Reveal from "./Reveal";
import { IconMeta, IconGoogle, IconLinkedIn, IconIndiamart, IconWebForm, IconCsv } from "./icons";

/**
 * Names match this app's own nav labels exactly (see layouts/nav.js):
 * "Meta Lead Ads", "Google Ads Lead Forms", "LinkedIn Lead Gen",
 * "IndiaMART Leads", "Website Forms", CSV Import.
 */
const INTEGRATIONS = [
  { icon: IconMeta, name: "Meta Lead Ads", desc: "Import leads from Facebook and Instagram lead ads" },
  { icon: IconGoogle, name: "Google Ads Lead Forms", desc: "Bring in leads from Google Ads lead form extensions" },
  { icon: IconLinkedIn, name: "LinkedIn Lead Gen", desc: "Connect LinkedIn Lead Gen Forms" },
  { icon: IconIndiamart, name: "IndiaMART Leads", desc: "Bring in buyer enquiries from IndiaMART" },
  { icon: IconWebForm, name: "Website Forms", desc: "Embed a form on any client website" },
  { icon: IconCsv, name: "CSV Import", desc: "Bring in existing lead data from a spreadsheet" },
];

export default function IntegrationsSection() {
  return (
    <section className="mkt-section mkt-dark-section" id="lead-sources">
      <div className="mkt-container">
        <div className="mkt-section-head">
          <Reveal as="h2" className="mkt-h2">
            Bring your leads together.
          </Reveal>
          <Reveal as="p" className="mkt-lead" delay={80}>
            Connect the lead sources your clients already depend on and manage everything from one workspace.
          </Reveal>
        </div>

        <div className="mkt-grid-3">
          {INTEGRATIONS.map(({ icon: Icon, name, desc }, i) => (
            <Reveal as="div" className="mkt-integration-chip" key={name} delay={i * 50}>
              <div className="mkt-card-icon">
                <Icon aria-hidden="true" />
              </div>
              <div>
                <strong>{name}</strong>
                <span>{desc}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
