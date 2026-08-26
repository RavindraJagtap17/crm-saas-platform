import { getCurrentUser, logout } from "../session.js";
import { initials } from "./ui.js";

const NAV = {
  super_admin: [
    { group: "Platform", items: [{ key: "overview", label: "Overview", href: "/public/super-admin/index.html", icon: "◆" }] },
  ],
  tenant_admin: [
    {
      group: "Workspace",
      items: [
        { key: "dashboard", label: "Dashboard", href: "/public/admin/dashboard.html", icon: "▤" },
        { key: "leads", label: "Leads", href: "/public/admin/leads.html", icon: "☍" },
      ],
    },
    {
      group: "Configure",
      items: [
        { key: "statuses", label: "Lead Statuses", href: "/public/admin/statuses.html", icon: "◔" },
        { key: "sources", label: "Lead Sources", href: "/public/admin/sources.html", icon: "⌘" },
        { key: "products", label: "Products", href: "/public/admin/products.html", icon: "▣" },
        { key: "custom-fields", label: "Custom Fields", href: "/public/admin/custom-fields.html", icon: "✎" },
        { key: "web-forms", label: "Website Forms", href: "/public/admin/web-forms.html", icon: "⌗" },
        { key: "meta-integration", label: "Meta Lead Ads", href: "/public/admin/meta-integration.html", icon: "◈" },
      ],
    },
    {
      group: "Agency",
      items: [
        { key: "employees", label: "Employees", href: "/public/admin/employees.html", icon: "◎" },
        { key: "branding", label: "Branding", href: "/public/admin/branding.html", icon: "◐" },
        { key: "billing", label: "Billing", href: "/public/admin/billing.html", icon: "$" },
      ],
    },
  ],
  tenant_employee: [
    {
      group: "Workspace",
      items: [
        { key: "dashboard", label: "Dashboard", href: "/public/employee/dashboard.html", icon: "▤" },
        { key: "leads", label: "My Leads", href: "/public/employee/leads.html", icon: "☍" },
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
  return `
    <span data-tenant-logo><span class="sidebar-logo-fallback" aria-hidden="true">…</span></span>
    <div>
      <div class="sidebar-brand-name" data-tenant-name>Loading…</div>
      <div class="sidebar-brand-tag">CRM Workspace</div>
    </div>`;
}

/**
 * Renders the sidebar/topbar shell for the current role into #shell-root
 * and returns the empty #page-content element the page should render its
 * own content into. Not a router — every nav link is a plain <a> to a
 * full page (§K: no custom framework).
 */
export function mountShell({ activeKey, title }) {
  const user = getCurrentUser();
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
              <div class="user-chip-role">${role.replace("_", " ")}</div>
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
