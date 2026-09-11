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

  // Reset first, then conditionally set: this SPA can move directly from
  // one tenant to another (dev-login role switch, no full page reload —
  // unlike the old app, which always reloaded on login and so never
  // needed to worry about a previous tenant's color surviving). Without
  // clearing first, a tenant with no custom brandPrimaryColor would keep
  // showing whichever color the last-viewed tenant had set.
  const root = document.documentElement.style;
  const brandProps = ["--brand-500", "--brand-600", "--brand-700", "--brand-50", "--brand-100", "--brand-contrast"];
  brandProps.forEach((prop) => root.removeProperty(prop));

  if (tenant.brandPrimaryColor) {
    root.setProperty("--brand-500", tenant.brandPrimaryColor);
    root.setProperty("--brand-600", shade(tenant.brandPrimaryColor, -12));
    root.setProperty("--brand-700", shade(tenant.brandPrimaryColor, -22));
    root.setProperty("--brand-50", shade(tenant.brandPrimaryColor, 92));
    root.setProperty("--brand-100", shade(tenant.brandPrimaryColor, 84));
    root.setProperty("--brand-contrast", readableTextOn(tenant.brandPrimaryColor));
  }

  return tenant;
}
