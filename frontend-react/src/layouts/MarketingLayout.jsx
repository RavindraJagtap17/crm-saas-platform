import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import MarketingNavbar from "../components/marketing/MarketingNavbar";
import MarketingFooter from "../components/marketing/MarketingFooter";

/**
 * Shared chrome for every public marketing page — sibling to Shell.jsx
 * (the authenticated app's own layout), never nested inside it and never
 * gated by ProtectedRoute. React Router doesn't scroll to a #hash on its
 * own the way a full page navigation would, so the navbar's dropdown
 * links (e.g. /features#lead-management) need this small effect to land
 * on the right section; a plain path change with no hash scrolls to top
 * instead, matching normal page-navigation expectations.
 */
export default function MarketingLayout() {
  const location = useLocation();

  useEffect(() => {
    // "instant", not "smooth": verified directly that a smooth scroll
    // here never actually completes in a backgrounded/inactive tab (the
    // browser's own smooth-scroll animation depends on the same frame
    // ticks requestAnimationFrame does, which a backgrounded tab can
    // suspend) — an instant jump has no such dependency and is the more
    // reliable choice for a scroll that must actually land correctly
    // every time, not just when the tab happens to be focused. Also
    // guarded against React StrictMode's dev-only double-invoke of this
    // effect via a cancelable timer, so only one of the two invocations
    // actually runs.
    const hash = location.hash;
    const timer = setTimeout(() => {
      const el = hash ? document.getElementById(hash.slice(1)) : null;
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "start" });
      } else {
        window.scrollTo({ top: 0 });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [location.pathname, location.hash]);

  return (
    <div className="mkt">
      <MarketingNavbar />
      <main id="main-content">
        <Outlet />
      </main>
      <MarketingFooter />
    </div>
  );
}
