import { Link } from "react-router-dom";
import Reveal from "./Reveal";

export default function CTASection() {
  return (
    <section className="mkt-section-tight">
      <div className="mkt-container">
        <Reveal as="div" className="mkt-cta">
          <h2 className="mkt-h2">Ready to bring your leads together?</h2>
          <p>Get started with MEP and give your agency one workspace for every client's lead operations.</p>
          <div className="mkt-btn-group">
            <Link to="/auth/signup" className="btn btn-primary mkt-btn-lg">
              Get Started
            </Link>
            <Link to="/contact" className="btn btn-secondary mkt-btn-lg" style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,0.3)" }}>
              Talk to Sales
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
