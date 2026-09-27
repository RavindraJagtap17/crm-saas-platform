import { Link } from "react-router-dom";
import { useDocumentMeta } from "../../utils/useDocumentMeta";
import Reveal from "../../components/marketing/Reveal";

/**
 * Neither a Privacy Policy nor Terms of Service exists yet in this
 * project. Rather than a fake legal document or a dead footer link, both
 * routes render this same honest "not yet published" notice — see
 * App.jsx for the two routes that use it.
 */
export default function LegalPlaceholder({ title }) {
  useDocumentMeta({ title, description: `MEP's ${title} is being finalized.` });

  return (
    <section className="mkt-section mkt-dark-section">
      <div className="mkt-container mkt-prose" style={{ textAlign: "center" }}>
        <Reveal>
          <h1 className="mkt-h2" style={{ marginBottom: "var(--space-4)" }}>
            {title}
          </h1>
          <p>
            This page is being finalized and isn&apos;t published yet. In the meantime, reach out through the{" "}
            <Link to="/contact" style={{ color: "#c4b5fd", fontWeight: "var(--weight-semibold)" }}>
              Contact page
            </Link>{" "}
            with any questions.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
