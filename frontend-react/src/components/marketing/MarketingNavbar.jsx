import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

/**
 * Dropdown sub-links point at anchors on the Features/Solutions pages
 * (e.g. /features#lead-management) rather than separate pages — those
 * pages don't exist as standalone routes, and creating placeholder pages
 * for each just to fill out a mega-menu would be exactly the kind of
 * dead-end link this site is explicitly asked to avoid. Resources
 * (Documentation/Help Center/FAQs) is omitted entirely for the same
 * reason: none of those pages exist yet.
 */
const PRODUCT_LINKS = [
  { to: "/features#lead-management", title: "Lead Management", desc: "Organize every lead in one workspace" },
  { to: "/features#lead-capture", title: "Lead Capture", desc: "Web forms and CSV import" },
  { to: "/features#lead-sources", title: "Lead Sources", desc: "Meta, Google Ads, LinkedIn, IndiaMART" },
  { to: "/features#lead-management", title: "Follow-ups", desc: "Keep every opportunity on schedule" },
  { to: "/features#analytics", title: "Analytics", desc: "Dashboards for your pipeline" },
];

const SOLUTIONS_LINKS = [
  { to: "/solutions#for-agencies", title: "For Agencies", desc: "Client and team lead operations" },
  { to: "/solutions#for-sales-teams", title: "For Sales Teams", desc: "Assignment and follow-up workflows" },
  { to: "/solutions#for-marketing-teams", title: "For Marketing Teams", desc: "Capture and route new leads" },
  { to: "/solutions#client-lead-management", title: "Client Lead Management", desc: "Keep every client's pipeline separate" },
];

function NavDropdown({ label, links, id }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const rootRef = useRef(null);

  const openNow = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, []);

  return (
    <div className="mkt-nav-item" ref={rootRef} onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        className="mkt-nav-link"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="mkt-caret" aria-hidden="true" />
      </button>
      <div className={`mkt-dropdown ${open ? "is-open" : ""}`} id={id} role="menu">
        {links.map((link) => (
          <Link key={link.title} to={link.to} className="mkt-dropdown-link" role="menuitem" onClick={() => setOpen(false)}>
            <strong>{link.title}</strong>
            <span>{link.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function MarketingNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <header className={`mkt-navbar ${scrolled ? "is-scrolled" : ""}`}>
      <nav className="mkt-navbar-inner" aria-label="Primary">
        <Link to="/" className="mkt-wordmark">
          <span className="mkt-mark" aria-hidden="true">M</span>
          MEP
        </Link>

        <div className="mkt-nav-links">
          <NavDropdown label="Product" links={PRODUCT_LINKS} id="mkt-nav-product" />
          <NavDropdown label="Solutions" links={SOLUTIONS_LINKS} id="mkt-nav-solutions" />
          <NavLink to="/pricing" className={({ isActive }) => `mkt-nav-link${isActive ? " is-active" : ""}`}>
            Pricing
          </NavLink>
        </div>

        <div className="mkt-nav-actions">
          <Link to="/auth" className="mkt-nav-link mkt-nav-desktop-only">
            Login
          </Link>
          <Link to="/auth/signup" className="btn btn-primary mkt-nav-desktop-only">
            Get Started
          </Link>
          <button
            type="button"
            className={`mkt-mobile-toggle ${mobileOpen ? "is-open" : ""}`}
            aria-expanded={mobileOpen}
            aria-controls="mkt-mobile-panel"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <span />
          </button>
        </div>
      </nav>

      <div id="mkt-mobile-panel" className={`mkt-mobile-panel ${mobileOpen ? "is-open" : ""}`}>
        <div className="mkt-mobile-group">
          <div className="mkt-mobile-group-label">Product</div>
          {PRODUCT_LINKS.map((link) => (
            <Link key={link.title} to={link.to} className="mkt-mobile-link">
              {link.title}
            </Link>
          ))}
        </div>
        <div className="mkt-mobile-group">
          <div className="mkt-mobile-group-label">Solutions</div>
          {SOLUTIONS_LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="mkt-mobile-link">
              {link.title}
            </Link>
          ))}
        </div>
        <div className="mkt-mobile-group">
          <Link to="/pricing" className="mkt-mobile-link">
            Pricing
          </Link>
          <Link to="/about" className="mkt-mobile-link">
            About
          </Link>
          <Link to="/contact" className="mkt-mobile-link">
            Contact
          </Link>
        </div>
        <div className="mkt-mobile-actions">
          <Link to="/auth" className="btn btn-secondary w-full">
            Login
          </Link>
          <Link to="/auth/signup" className="btn btn-primary w-full">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}
