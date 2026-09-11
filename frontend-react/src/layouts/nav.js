// Ported from the old frontend's components/shell.js NAV config — same
// groups/items/icons per role, .html hrefs translated to React Router
// paths. Every group/item matches the approved role boundaries exactly:
// this list is a convenience, not the security boundary (ProtectedRoute +
// the backend are).
export const NAV = {
  super_admin: [
    {
      group: "Platform",
      items: [
        { key: "overview", label: "Platform Overview", to: "/super-admin", icon: "◆" },
        { key: "integration-monitoring", label: "Integration Monitoring", to: "/super-admin/integration-monitoring", icon: "⌗" },
        { key: "client-license-price", label: "Client License Price", to: "/super-admin/client-license-price", icon: "◈" },
      ],
    },
  ],
  agency_admin: [
    {
      group: "Agency",
      items: [
        { key: "clients", label: "Clients", to: "/agency/clients", icon: "◎" },
        { key: "web-forms", label: "Website Forms", to: "/agency/web-forms", icon: "⌗" },
        { key: "custom-fields", label: "Custom Fields", to: "/agency/custom-fields", icon: "✎" },
        { key: "branding", label: "Branding", to: "/agency/branding", icon: "◐" },
      ],
    },
  ],
  client_admin: [
    {
      group: "Workspace",
      items: [
        { key: "dashboard", label: "Dashboard", to: "/admin/dashboard", icon: "▤" },
        { key: "leads", label: "Leads", to: "/admin/leads", icon: "☍" },
        { key: "follow-ups", label: "Follow-ups", to: "/admin/follow-ups", icon: "⏰" },
      ],
    },
    {
      group: "Configure",
      items: [
        { key: "statuses", label: "Lead Statuses", to: "/admin/statuses", icon: "◔" },
        { key: "sources", label: "Lead Sources", to: "/admin/sources", icon: "⌘" },
        { key: "products", label: "Products", to: "/admin/products", icon: "▣" },
        { key: "meta-integration", label: "Meta Lead Ads", to: "/admin/meta-integration", icon: "◈" },
        { key: "linkedin-integration", label: "LinkedIn Lead Gen", to: "/admin/linkedin-integration", icon: "◫" },
        { key: "google-integration", label: "Google Ads Lead Forms", to: "/admin/google-integration", icon: "▧" },
        { key: "indiamart-integration", label: "IndiaMART Leads", to: "/admin/indiamart-integration", icon: "◨" },
      ],
    },
    {
      group: "Team",
      items: [{ key: "employees", label: "Employees", to: "/admin/employees", icon: "◎" }],
    },
  ],
  client_employee: [
    {
      group: "Workspace",
      items: [
        { key: "dashboard", label: "Dashboard", to: "/employee/dashboard", icon: "▤" },
        { key: "leads", label: "Leads", to: "/employee/leads", icon: "☍" },
        { key: "follow-ups", label: "Follow-ups", to: "/employee/follow-ups", icon: "⏰" },
      ],
    },
  ],
};

// Follow-up topbar indicator — same two roles as the old app.
export const FOLLOWUP_ROLES = new Set(["client_admin", "client_employee"]);
export const FOLLOWUP_LIST_PATH = { client_admin: "/admin/follow-ups", client_employee: "/employee/follow-ups" };
