import { api } from "./api/client.js";

// Derives readable darker/lighter shades from one tenant brand color so
// hover states etc. don't need a second color picked by the admin.
function shade(hex, percent) {
  const n = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0x00ff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0x0000ff) + amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function readableTextOn(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = n >> 16, g = (n >> 8) & 0xff, b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#14161f" : "#ffffff";
}

/**
 * Applies a tenant's branding (§G) to the page: title, sidebar
 * name/logo, and the --brand-* tokens every component already reads
 * from. Skipped entirely for Super Admin pages, which keep the fixed
 * platform identity from tokens.css instead.
 */
export async function applyTenantBranding() {
  let tenant;
  try {
    const data = await api.get("/api/tenant");
    tenant = data.tenant;
  } catch {
    return null;
  }

  if (tenant.brandPrimaryColor) {
    const root = document.documentElement.style;
    root.setProperty("--brand-500", tenant.brandPrimaryColor);
    root.setProperty("--brand-600", shade(tenant.brandPrimaryColor, -12));
    root.setProperty("--brand-700", shade(tenant.brandPrimaryColor, -22));
    root.setProperty("--brand-50", shade(tenant.brandPrimaryColor, 92));
    root.setProperty("--brand-100", shade(tenant.brandPrimaryColor, 84));
    root.setProperty("--brand-contrast", readableTextOn(tenant.brandPrimaryColor));
  }

  document.title = `${document.title} · ${tenant.name}`;

  document.querySelectorAll("[data-tenant-name]").forEach((el) => (el.textContent = tenant.name));
  document.querySelectorAll("[data-tenant-logo]").forEach((el) => {
    if (tenant.logoUrl) {
      el.innerHTML = `<img src="${tenant.logoUrl}" alt="${tenant.name} logo" class="sidebar-logo" />`;
    } else {
      const initial = (tenant.name || "?").trim().charAt(0).toUpperCase();
      el.innerHTML = `<span class="sidebar-logo-fallback" aria-hidden="true">${initial}</span>`;
    }
  });

  return tenant;
}
