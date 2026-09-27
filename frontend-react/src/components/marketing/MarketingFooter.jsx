import { Link } from "react-router-dom";

/**
 * Resources (Documentation/Help Center/FAQs) is intentionally omitted —
 * none of those pages exist yet, and this site is explicitly asked not to
 * link to pages that don't exist. Legal links point at /legal/privacy and
 * /legal/terms, which render an honest "not yet published" notice rather
 * than an invented policy — see LegalPlaceholder.jsx. There's no Socials
 * column (no real social profile exists anywhere in this project) and no
 * Cookie Policy / Forgot Password link (neither exists) — "Solutions"
 * fills the fourth column instead, using content this footer already had.
 */
export default function MarketingFooter() {
  return (
    <footer className="mkt-footer">
      <div className="mkt-container mkt-footer-inner">
        <div className="mkt-footer-top">
          <div className="mkt-footer-brand">
            <Link to="/" className="mkt-wordmark">
              <span className="mkt-mark" aria-hidden="true">M</span>
              MEP
            </Link>
            <p>The lead management platform built for modern agencies.</p>
            <p className="mkt-footer-copyright">© {new Date().getFullYear()} MEP. All rights reserved.</p>
          </div>

          <div>
            <div className="mkt-footer-col-title">Pages</div>
            <div className="mkt-footer-links">
              <Link to="/">Home</Link>
              <Link to="/features">Features</Link>
              <Link to="/pricing">Pricing</Link>
              <Link to="/about">About</Link>
              <Link to="/contact">Contact</Link>
            </div>
          </div>

          <div>
            <div className="mkt-footer-col-title">Solutions</div>
            <div className="mkt-footer-links">
              <Link to="/solutions#for-agencies">For Agencies</Link>
              <Link to="/solutions#for-sales-teams">For Sales Teams</Link>
              <Link to="/solutions#for-marketing-teams">For Marketing Teams</Link>
            </div>
          </div>

          <div>
            <div className="mkt-footer-col-title">Legal</div>
            <div className="mkt-footer-links">
              <Link to="/legal/privacy">Privacy Policy</Link>
              <Link to="/legal/terms">Terms of Service</Link>
            </div>
          </div>

          <div>
            <div className="mkt-footer-col-title">Account</div>
            <div className="mkt-footer-links">
              <Link to="/auth/signup">Sign Up</Link>
              <Link to="/auth">Login</Link>
            </div>
          </div>
        </div>

        <div className="mkt-footer-brandmark" aria-hidden="true">
          MEP
        </div>
      </div>
    </footer>
  );
}
