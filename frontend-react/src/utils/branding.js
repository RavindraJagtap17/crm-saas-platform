import { tenantApi } from "../api/resources";

// Derives readable darker/lighter shades from one tenant brand color —
// ported verbatim from the old frontend's branding.js.
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
 * Fetches and applies a tenant's branding: --brand-* CSS custom properties
 * (every component already reads from them) + returns the tenant object
 * for the Shell to render name/logo with. Ported from the old frontend's
 * branding.js applyTenantBranding() — the document.title suffix and
 * direct DOM querying for [data-tenant-name]/[data-tenant-logo] are
 * dropped in favor of the Shell rendering those directly from the
 * returned tenant object as JSX (a React-idiomatic replacement for what
 * was, in the old app, a manual DOM patch after the fact).
 */
export async function applyTenantBranding() {
  let tenant;
  try {
    const data = await tenantApi.get();
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

  return tenant;
}
