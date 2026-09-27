import { useDocumentMeta } from "../../utils/useDocumentMeta";
import Reveal from "../../components/marketing/Reveal";
import CTASection from "../../components/marketing/CTASection";

/**
 * No invented founders, history, funding, customer counts, or awards —
 * none of that exists in this project. Kept to what MEP actually is and
 * the problem it addresses.
 */
export default function About() {
  useDocumentMeta({
    title: "About",
    description: "MEP is the lead management platform built for agencies managing leads across multiple clients.",
  });

  return (
    <>
      <section className="mkt-section mkt-dark-section is-alt">
        <div className="mkt-container">
          <div className="mkt-about-figure" aria-hidden="true">MEP</div>
        </div>
        <div className="mkt-container mkt-prose">
          <Reveal as="div" className="mkt-eyebrow" style={{ marginBottom: "var(--space-4)" }}>
            About MEP
          </Reveal>
          <Reveal as="h1" className="mkt-h1" style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)", marginBottom: "var(--space-6)" }} delay={60}>
            Lead management, built around how agencies actually work.
          </Reveal>

          <Reveal delay={120}>
            <p>
              Most lead-management tools are built for a single company selling to its own customers. Agencies don&apos;t
              work that way — they manage leads on behalf of multiple clients at once, each with its own sources,
              team, and pipeline. MEP was built around that reality from the start.
            </p>

            <h2 className="mkt-h3">The problem</h2>
            <p>
              Without a system built for it, agencies end up running client lead operations across a patchwork of
              spreadsheets, inboxes, and tools that were never designed for more than one business at a time. Leads
              get missed, ownership gets unclear, and it becomes hard to see what&apos;s actually happening across a
              client portfolio.
            </p>

            <h2 className="mkt-h3">Why agency-focused lead management matters</h2>
            <p>
              An agency isn&apos;t just a bigger version of a single sales team — it&apos;s several client operations running
              in parallel, each needing its own separation, its own sources, and its own visibility. MEP is structured
              around that: an agency workspace on top, each client&apos;s leads and team kept separate underneath.
            </p>

            <h2 className="mkt-h3">Our product philosophy</h2>
            <p>
              Keep the core lead workflow — capture, organize, assign, follow up, convert — simple and reliable, and
              build the agency-specific structure around it rather than bolting client management onto a generic CRM
              after the fact.
            </p>
          </Reveal>
        </div>
      </section>

      <CTASection />
    </>
  );
}
