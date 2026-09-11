import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { applyTenantBranding } from "../utils/branding";
import { dashboardApi } from "../api/resources";
import { NAV, FOLLOWUP_ROLES, FOLLOWUP_LIST_PATH } from "./nav";
import { PageTitleProvider } from "./PageTitleContext";
import { subscribeFollowUpIndicator } from "./followUpIndicatorBus";

const BRAND_TAG = { agency_admin: "Agency Console", client_admin: "Client Admin", client_employee: "Client Employee" };

function initialsOf(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function BrandBlock({ role, tenant }) {
  if (role === "super_admin") {
    return (
      <>
        <span className="sidebar-logo-fallback" aria-hidden="true">◆</span>
        <div>
          <div className="sidebar-brand-name">Platform Console</div>
          <div className="sidebar-brand-tag">Super Admin</div>
        </div>
      </>
    );
  }
  return (
    <>
      {tenant?.logoUrl ? (
        <img src={tenant.logoUrl} alt={`${tenant.name} logo`} className="sidebar-logo" />
      ) : (
        <span className="sidebar-logo-fallback" aria-hidden="true">{(tenant?.name || "?").trim().charAt(0).toUpperCase()}</span>
      )}
      <div>
        <div className="sidebar-brand-name">{tenant?.name || "Loading…"}</div>
        <div className="sidebar-brand-tag">{BRAND_TAG[role]}</div>
      </div>
    </>
  );
}

function FollowUpIndicator({ role }) {
  const [counts, setCounts] = useState(undefined); // undefined = loading, null = failed/hidden
  const basePath = FOLLOWUP_LIST_PATH[role];

  const load = useCallback(async () => {
    try {
      const { overdue, dueToday } = await dashboardApi.followUpCounts();
      setCounts({ overdue, dueToday });
    } catch (err) {
      console.error("Follow-up indicator failed to load:", err.message);
      setCounts(null);
    }
  }, []);

  useEffect(() => {
    load();
    return subscribeFollowUpIndicator(load);
  }, [load]);

  if (counts === null) return null; // quiet by design — a passive background indicator, not a user-initiated action

  let href = basePath;
  let title = "Follow-ups";
  let body = (
    <span className="skeleton skeleton-text" style={{ width: 56, height: 14, display: "inline-block", verticalAlign: "middle" }} />
  );
  if (counts) {
    if (counts.overdue === 0 && counts.dueToday === 0) {
      body = <span className="text-tertiary text-xs">No follow-ups due</span>;
      title = "No follow-ups due";
    } else {
      body = (
        <>
          {counts.overdue > 0 ? <span className="badge badge-danger">{counts.overdue} overdue</span> : null}
          {counts.dueToday > 0 ? <span className="badge badge-warning">{counts.dueToday} due today</span> : null}
        </>
      );
      title = `Overdue: ${counts.overdue}\nDue today: ${counts.dueToday}`;
      href = `${basePath}?view=${counts.overdue > 0 ? "overdue" : "today"}`;
    }
  }

  return (
    <Link className="followup-indicator" to={href} title={title}>
      <span aria-hidden="true">⏰</span>
      <span>Follow-ups</span>
      <span>{body}</span>
    </Link>
  );
}

/**
 * Main app shell — sidebar/topbar layout, ported from the old frontend's
 * components/shell.js mountShell(). Now a React Router LAYOUT route
 * wrapping every role-specific page via <Outlet/> instead of something
 * every page's own main() called individually — branding/nav/indicator
 * fetch happens ONCE when a role area is entered, not on every navigation.
 */
export default function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState(null);

  const role = user.role;
  const groups = NAV[role] || [];

  useEffect(() => {
    if (role === "super_admin") {
      // Clear any tenant brand color left inline on <html> by a previous
      // Client/Agency Admin session in this SPA — an inline style always
      // beats the [data-app-mode="platform"] stylesheet rule below, so a
      // stale --brand-* here would otherwise bleed the wrong color into
      // the platform theme instead of its fixed amber.
      const root = document.documentElement.style;
      ["--brand-500", "--brand-600", "--brand-700", "--brand-50", "--brand-100", "--brand-contrast"].forEach((prop) => root.removeProperty(prop));
      return;
    }
    applyTenantBranding().then(setTenant);
  }, [role]);

  useEffect(() => {
    document.documentElement.setAttribute("data-app-mode", role === "super_admin" ? "platform" : "");
  }, [role]);

  useEffect(() => {
    if (tenant?.name) document.title = `CRM · ${tenant.name}`;
  }, [tenant]);

  const activeKey = useMemo(() => {
    let best = null;
    for (const group of groups) {
      for (const item of group.items) {
        if (location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)) {
          if (!best || item.to.length > best.to.length) best = item;
        }
      }
    }
    return best?.key || null;
  }, [groups, location.pathname]);

  const topbarTitle = pageTitle ?? groups.flatMap((g) => g.items).find((i) => i.key === activeKey)?.label ?? "";

  const handleLogout = async () => {
    await logout();
    navigate("/auth", { replace: true });
  };

  return (
    <PageTitleProvider value={setPageTitle}>
      <a className="skip-link" href="#page-content">Skip to content</a>
      <div className={`app-shell ${navOpen ? "nav-open" : ""}`} id="app-shell">
        <div className="nav-overlay" onClick={() => setNavOpen(false)} />
        <aside className="sidebar" aria-label="Primary navigation">
          <div className="sidebar-brand">
            <BrandBlock role={role} tenant={tenant} />
          </div>
          <nav className="nav-group">
            {groups.map((g, gi) => (
              <div key={g.group}>
                {gi > 0 ? <div className="divider" /> : null}
                <div className="nav-group-label">{g.group}</div>
                {g.items.map((item) => (
                  <NavLink key={item.key} className={`nav-link ${item.key === activeKey ? "is-active" : ""}`} to={item.to} onClick={() => setNavOpen(false)}>
                    <span className="icon" aria-hidden="true">{item.icon}</span> {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="user-chip">
              <span className="avatar avatar-sm" aria-hidden="true">{initialsOf(user.name)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="user-chip-name truncate">{user.name}</div>
                <div className="user-chip-role">{role.replace(/_/g, " ")}</div>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm w-full mt-2" onClick={handleLogout}>Sign out</button>
          </div>
        </aside>
        <div className="main-column">
          <header className="topbar">
            <div className="flex items-center gap-3">
              <button className="menu-toggle" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>☰</button>
              <h1 className="topbar-title">{topbarTitle}</h1>
            </div>
            <div className="topbar-actions">
              {FOLLOWUP_ROLES.has(role) ? <FollowUpIndicator role={role} /> : null}
            </div>
          </header>
          <main className="page-content" id="page-content" tabIndex={-1}>
            <Outlet context={{ tenant }} />
          </main>
        </div>
      </div>
    </PageTitleProvider>
  );
}
