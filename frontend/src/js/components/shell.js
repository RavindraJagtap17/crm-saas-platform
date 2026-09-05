import { getCurrentUser, logout } from "../session.js";
import { initials } from "./ui.js";

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
        { key: "plans", label: "Agency Plan", href: "/public/super-admin/plans.html", icon: "$" },
      ],
    },
  ],
  agency_admin: [
    {
      group: "Agency",
      items: [
        { key: "clients", label: "Clients", href: "/public/agency/clients.html", icon: "◎" },
        { key: "client-plans", label: "Client Plans", href: "/public/agency/client-plans.html", icon: "▤" },
        { key: "web-forms", label: "Website Forms", href: "/public/agency/web-forms.html", icon: "⌗" },
        { key: "custom-fields", label: "Custom Fields", href: "/public/agency/custom-fields.html", icon: "✎" },
        { key: "branding", label: "Branding", href: "/public/agency/branding.html", icon: "◐" },
        { key: "billing", label: "Billing", href: "/public/agency/billing.html", icon: "$" },
        { key: "razorpay-connect", label: "Razorpay Account", href: "/public/agency/razorpay-connect.html", icon: "⇄" },
      ],
    },
  ],
  client_admin: [
    {
      group: "Workspace",
      items: [
        { key: "dashboard", label: "Dashboard", href: "/public/admin/dashboard.html", icon: "▤" },
        { key: "leads", label: "Leads", href: "/public/admin/leads.html", icon: "☍" },
        { key: "billing", label: "Billing", href: "/public/admin/billing.html", icon: "$" },
      ],
    },
    {
      group: "Configure",
      items: [
        { key: "statuses", label: "Lead Statuses", href: "/public/admin/statuses.html", icon: "◔" },
        { key: "sources", label: "Lead Sources", href: "/public/admin/sources.html", icon: "⌘" },
        { key: "products", label: "Products", href: "/public/admin/products.html", icon: "▣" },
        { key: "meta-integration", label: "Meta Lead Ads", href: "/public/admin/meta-integration.html", icon: "◈" },
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
 *  - agency_admin: blocked only by their own agency's status; sent to
 *    Billing, the one page that can fix it (billing itself must pass
 *    allowBlocked so this never loops).
 *  - client_admin / client_employee: blocked by EITHER their client's
 *    status or their agency's status — neither role has any billing
 *    capability at all, so they're sent to a plain explanatory page
 *    instead of somewhere they can't act on.
 */
function computeBlockedRedirect(user) {
  if (user.role === "super_admin") return null;

  if (user.role === "agency_admin") {
    if (!user.tenantStatus || user.tenantStatus === "active") return null;
    return "/public/agency/billing.html";
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

/**
 * Renders the sidebar/topbar shell for the current role into #shell-root
 * and returns the empty #page-content element the page should render its
 * own content into. Not a router — every nav link is a plain <a> to a
 * full page (no custom framework).
 *
 * allowBlocked: pass true only from the one page a blocked user must
 * still be able to reach (agency/billing.html, admin/account-inactive.html,
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
          <div class="topbar-actions" id="topbar-actions"></div>
        </header>
        <main class="page-content" id="page-content" tabindex="-1"></main>
      </div>
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", logout);

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
