import { Link } from "react-router-dom";
import Reveal from "./Reveal";
import ProductMockup from "./ProductMockup";

export default function Hero() {
  return (
    <section className="mkt-hero">
      <div className="mkt-beam" aria-hidden="true" />
      <div className="mkt-container mkt-hero-inner">
        <Reveal className="mkt-hero-copy">
          <div className="mkt-eyebrow mkt-hero-eyebrow">The lead management platform for agencies</div>
          <h1 className="mkt-h1">Turn every lead into an opportunity.</h1>
          <p className="mkt-lead">
            MEP gives agencies one platform to capture, organize, assign, and follow up with leads from multiple
            sources — while managing client operations from one place.
          </p>
          <div className="mkt-btn-group">
            <Link to="/auth/signup" className="btn btn-primary mkt-btn-lg">
              Get Started
            </Link>
            <Link to="/contact" className="btn btn-secondary mkt-btn-lg">
              Book a Demo
            </Link>
          </div>
        </Reveal>

        <Reveal className="mkt-hero-visual" delay={120}>
          <ProductMockup caption="Illustrative preview of the MEP workspace" />
        </Reveal>
      </div>
    </section>
  );
}
