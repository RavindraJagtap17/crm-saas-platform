import { getCurrentUser, logout } from "../session.js";
import { initials } from "./ui.js";
import { dashboardApi } from "../api/resources.js";

/**
 * B2B2C restructure: navigation is rebuilt per role from scratch, not
 * relabeled from the old tenant_admin/tenant_employee map. Every group/
 * item here matches the approved role boundaries exactly — Agency Admin
 * never gets a Leads/CRM link, Client Admin/Employee never get a
 * Clients/Billing/Branding/Website-Forms link, and Client Employee never
 * gets a Configure/Team link. There is no hidden-but-navigable item: the
 * items simply don't exist for a role that shouldn't have them, and every
 * page they'd otherwise reach enforces its own requireRole() guard
 * independently (see each page's main()) — this list is a convenience,
 * not the security boundary.
 */
const NAV = {
  super_admin: [
    {
      group: "Platform",
      items: [
        { key: "overview", label: "Platform Overview", href: "/public/super-admin/index.html", icon: "◆" },
        { key: "integration-monitoring", label: "Integration Monitoring", href: "/public/super-admin/integration-monitoring.html", icon: "⌗" },
        { key: "client-license-price", label: "Client License Price", href: "/public/super-admin/client-license-price.html", icon: "◈" },
      ],
    },
  ],
  agency_admin: [
    {
      group: "Agency",
      items: [
        { key: "clients", label: "Clients", href: "/public/agency/clients.html", icon: "◎" },
        { key: "web-forms", label: "Website Forms", href: "/public/agency/web-forms.html", icon: "⌗" },
        { key: "custom-fields", label: "Custom Fields", href: "/public/agency/custom-fields.html", icon: "✎" },
        { key: "branding", label: "Branding", href: "/public/agency/branding.html", icon: "◐" },
      ],
    },
  ],
  client_admin: [
    {
      group: "Workspace",
      items: [
        { key: "dashboard", label: "Dashboard", href: "/public/admin/dashboard.html", icon: "▤" },
        { key: "leads", label: "Leads", href: "/public/admin/leads.html", icon: "☍" },
        { key: "follow-ups", label: "Follow-ups", href: "/public/admin/follow-ups.html", icon: "⏰" },
      ],
    },
    {
      group: "Configure",
      items: [
        { key: "statuses", label: "Lead Statuses", href: "/public/admin/statuses.html", icon: "◔" },
        { key: "sources", label: "Lead Sources", href: "/public/admin/sources.html", icon: "⌘" },
        { key: "products", label: "Products", href: "/public/admin/products.html", icon: "▣" },
        { key: "meta-integration", label: "Meta Lead Ads", href: "/public/admin/meta-integration.html", icon: "◈" },
        { key: "linkedin-integration", label: "LinkedIn Lead Gen", href: "/public/admin/linkedin-integration.html", icon: "◫" },
        { key: "google-integration", label: "Google Ads Lead Forms", href: "/public/admin/google-integration.html", icon: "▧" },
        { key: "indiamart-integration", label: "IndiaMART Leads", href: "/public/admin/indiamart-integration.html", icon: "◨" },
      ],
    },
    {
      group: "Team",
      items: [{ key: "employees", label: "Employees", href: "/public/admin/employees.html", icon: "◎" }],
    },
  ],
  client_employee: [
    {
      group: "Workspace",
      items: [
        { key: "dashboard", label: "Dashboard", href: "/public/employee/dashboard.html", icon: "▤" },
        { key: "leads", label: "Leads", href: "/public/employee/leads.html", icon: "☍" },
        { key: "follow-ups", label: "Follow-ups", href: "/public/employee/follow-ups.html", icon: "⏰" },
      ],
    },
  ],
};

function brandBlockHtml(role) {
  if (role === "super_admin") {
    return `
      <span class="sidebar-logo-fallback" aria-hidden="true">◆</span>
      <div>
        <div class="sidebar-brand-name">Platform Console</div>
        <div class="sidebar-brand-tag">Super Admin</div>
      </div>`;
  }
  // agency_admin, client_admin, client_employee: all three now read real
  // agency branding (name/logo/color) via GET /api/tenant — post-Phase-D
  // fix, that route is readable by every non-super_admin role (still
  // agency_admin-only to EDIT). applyTenantBranding() fills these
  // placeholders in; called by every page AFTER mountShell() so they
  // already exist in the DOM (see each page's main() for the ordering
  // note this depends on).
  const tag = { agency_admin: "Agency Console", client_admin: "Client Admin", client_employee: "Client Employee" }[role];
  return `
    <span data-tenant-logo><span class="sidebar-logo-fallback" aria-hidden="true">…</span></span>
    <div>
      <div class="sidebar-brand-name" data-tenant-name>Loading…</div>
      <div class="sidebar-brand-tag">${tag}</div>
    </div>`;
}

/**
 * Where a blocked (agency-inactive or client-inactive) user of this role
 * should land, and whether they're blocked at all. UX-only — the
 * backend's requireActiveTenant middleware (now two-level: client status
 * AND agency status for client-level roles) is the actual enforcement on
 * every API call regardless of what this decides.
 *
 *  - super_admin: never blocked.
 *  - agency_admin: blocked only by their own agency's status; sent to a
 *    plain explanatory page — "Agency pays per Client" restructure means
 *    an Agency has no billing capability of its own to fix this with
 *    anymore (a suspension is a manual Super Admin action).
 *  - client_admin / client_employee: blocked by EITHER their client's
 *    status or their agency's status — neither role has any billing
 *    capability at all, so they're sent to a plain explanatory page
 *    instead of somewhere they can't act on.
 */
function computeBlockedRedirect(user) {
  if (user.role === "super_admin") return null;

  if (user.role === "agency_admin") {
    if (!user.tenantStatus || user.tenantStatus === "active") return null;
    return "/public/agency/account-inactive.html";
  }

  if (user.role === "client_admin" || user.role === "client_employee") {
    const agencyBlocked = !!user.tenantStatus && user.tenantStatus !== "active";
    const clientBlocked = !!user.clientStatus && user.clientStatus !== "active";
    if (!agencyBlocked && !clientBlocked) return null;
    return user.role === "client_admin" ? "/public/admin/account-inactive.html" : "/public/employee/account-inactive.html";
  }

  return null;
}

function redirectIfBlocked(user, allowBlocked) {
  if (allowBlocked) return false;
  const destination = computeBlockedRedirect(user);
  if (!destination) return false;
  if (window.location.pathname === destination) return false;
  window.location.replace(destination);
  return true;
}

// Follow-up due/overdue topbar indicator (§ CRM feature-gap audit — the
// dashboard already computes these counts via leadFollowUpModel.
// dashboardCounts; this reuses that through the new lightweight
// GET /api/dashboard/follow-up-counts endpoint rather than duplicating
// any calculation here). Only these two roles have a client-scoped
// follow-up worklist at all — Agency Admin/Super Admin operate a level
// above individual leads and never see this.
const FOLLOWUP_ROLES = new Set(["client_admin", "client_employee"]);
const FOLLOWUP_LIST_HREF = { client_admin: "/public/admin/follow-ups.html", client_employee: "/public/employee/follow-ups.html" };

function followUpIndicatorHtml(role) {
  return `
    <a class="followup-indicator" id="followup-indicator" href="${FOLLOWUP_LIST_HREF[role]}" title="Follow-ups">
      <span aria-hidden="true">⏰</span>
      <span>Follow-ups</span>
      <span id="followup-indicator-counts"><span class="skeleton skeleton-text" style="width:56px;height:14px;display:inline-block;vertical-align:middle"></span></span>
    </a>`;
}

/**
 * Fetches the current overdue/due-today counts and fills them into the
 * indicator already in the DOM (rendered synchronously by mountShell, see
 * below) — never blocks the page render on this network call. On failure,
 * hides the indicator entirely rather than showing a stale or fake count
 * (Phase 9 of the feature spec: don't break the shell, don't lie about data).
 */
async function loadFollowUpIndicator() {
  const el = document.getElementById("followup-indicator");
  if (!el) return; // not this role, or shell not mounted with the indicator
  try {
    const { overdue, dueToday } = await dashboardApi.followUpCounts();
    const countsEl = document.getElementById("followup-indicator-counts");
    if (!countsEl) return; // page navigated away while the request was in flight
    // Deep-links straight to whichever view is most urgent — matches the
    // exact same "view" values the Follow-ups list page itself accepts
    // (admin-follow-ups.js/employee-follow-ups.js VIEWS), never a new
    // filtering scheme invented just for this link.
    const base = el.getAttribute("href").split("?")[0];
    if (overdue === 0 && dueToday === 0) {
      countsEl.innerHTML = `<span class="text-tertiary text-xs">No follow-ups due</span>`;
      el.title = "No follow-ups due";
      el.href = base;
    } else {
      countsEl.innerHTML = `
        ${overdue > 0 ? `<span class="badge badge-danger">${overdue} overdue</span>` : ""}
        ${dueToday > 0 ? `<span class="badge badge-warning">${dueToday} due today</span>` : ""}`;
      el.title = `Overdue: ${overdue}\nDue today: ${dueToday}`;
      el.href = `${base}?view=${overdue > 0 ? "overdue" : "today"}`;
    }
  } catch (err) {
    // Quiet by design — this is a passive background indicator, not a
    // user-initiated action, so a toast would be noise. Hiding it means a
    // transient failure never shows a stale/fake count.
    console.error("Follow-up indicator failed to load:", err.message);
    el.style.display = "none";
  }
}

/**
 * Exported so any page that mutates a follow-up WITHOUT a full page
 * navigation (today, only followUpPanel.js's schedule/reschedule/complete/
 * cancel actions on the lead-detail pages) can refresh the topbar count in
 * place — everywhere else, a normal `<a>` page navigation already remounts
 * the shell and re-fetches fresh, matching this app's existing no-SPA,
 * reload-per-navigation architecture (see this file's own module comment).
 * Safe to call from a role that has no indicator (loadFollowUpIndicator
 * itself no-ops when the element isn't present).
 */
export function refreshFollowUpIndicator() {
  return loadFollowUpIndicator();
}

/**
 * Renders the sidebar/topbar shell for the current role into #shell-root
 * and returns the empty #page-content element the page should render its
 * own content into. Not a router — every nav link is a plain <a> to a
 * full page (no custom framework).
 *
 * allowBlocked: pass true only from the one page a blocked user must
 * still be able to reach (agency/account-inactive.html, admin/account-inactive.html,
 * employee/account-inactive.html) — everywhere else, a blocked user is
 * redirected there instead of rendering.
 */
export function mountShell({ activeKey, title, allowBlocked = false }) {
  const user = getCurrentUser();
  if (redirectIfBlocked(user, allowBlocked)) {
    // window.location.replace() doesn't halt script execution synchronously
    // — the calling page's main() keeps running for a moment unless it
    // checks for this. Returns null (every caller must check `if (!content)
    // return;` right after calling mountShell) rather than a detached
    // element: a detached element only makes `content.innerHTML = …` safe,
    // but every page also has its own `document.getElementById(...)` calls
    // that reach into the real, live document — those aren't inside the
    // detached element at all and throw when the just-rendered content
    // was never actually attached. null forces every page to stop
    // rendering entirely instead of relying on that assumption.
    return null;
  }

  const role = user.role;
  const groups = NAV[role] || [];
  if (role === "super_admin") document.documentElement.setAttribute("data-app-mode", "platform");

  const navHtml = groups
    .map(
      (g) => `
      <div class="nav-group-label">${g.group}</div>
      ${g.items
        .map(
          (item) => `
        <a class="nav-link ${item.key === activeKey ? "is-active" : ""}" href="${item.href}">
          <span class="icon" aria-hidden="true">${item.icon}</span> ${item.label}
        </a>`
        )
        .join("")}
    `
    )
    .join('<div class="divider"></div>');

  const root = document.getElementById("shell-root");
  root.innerHTML = `
    <a class="skip-link" href="#page-content">Skip to content</a>
    <div class="app-shell" id="app-shell">
      <div class="nav-overlay" id="nav-overlay"></div>
      <aside class="sidebar" aria-label="Primary navigation">
        <div class="sidebar-brand">${brandBlockHtml(role)}</div>
        <nav class="nav-group">${navHtml}</nav>
        <div class="sidebar-footer">
          <div class="user-chip">
            <span class="avatar avatar-sm" aria-hidden="true">${initials(user.name)}</span>
            <div style="min-width:0">
              <div class="user-chip-name truncate">${user.name}</div>
              <div class="user-chip-role">${role.replace(/_/g, " ")}</div>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm w-full mt-2" id="logout-btn">Sign out</button>
        </div>
      </aside>
      <div class="main-column">
        <header class="topbar">
          <div class="flex items-center gap-3">
            <button class="menu-toggle" id="menu-toggle" aria-label="Open navigation" aria-expanded="false">☰</button>
            <h1 class="topbar-title">${title}</h1>
          </div>
          <div class="topbar-actions" id="topbar-actions">${FOLLOWUP_ROLES.has(role) ? followUpIndicatorHtml(role) : ""}</div>
        </header>
        <main class="page-content" id="page-content" tabindex="-1"></main>
      </div>
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", logout);
  if (FOLLOWUP_ROLES.has(role)) loadFollowUpIndicator();

  const shell = document.getElementById("app-shell");
  const overlay = document.getElementById("nav-overlay");
  const toggle = document.getElementById("menu-toggle");
  toggle.addEventListener("click", () => {
    const open = shell.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  overlay.addEventListener("click", () => {
    shell.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
  });

  return document.getElementById("page-content");
}
