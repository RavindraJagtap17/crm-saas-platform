/**
 * Session state lives in memory only — never localStorage/sessionStorage.
 * This is a traditional multi-page app (every navigation is a full page
 * load, no client router), so persistence across pages comes from the
 * httpOnly refresh cookie instead: every protected page calls
 * bootstrapSession() on load, which POSTs /api/auth/refresh (the cookie
 * goes automatically) to mint a fresh access token for that page's
 * lifetime. This means the access token is never exposed to anything an
 * XSS payload could read out of browser storage, and it also means the
 * refresh flow is genuinely exercised on every page view, not just once.
 *
 * B2B2C restructure: the session user object now carries tenantId
 * (agency — resolved server-side via clients.tenant_id for client-level
 * roles), clientId, tenantStatus, and clientStatus. The frontend NEVER
 * computes or overrides any of these — they come only from the backend's
 * own response to /me, /refresh, /google, or /dev-login, never from a URL
 * query param, localStorage, or a form field.
 */
export const API_BASE_URL = window.CRM_CONFIG?.API_BASE_URL || "http://localhost:4000";
export const GOOGLE_CLIENT_ID = window.CRM_CONFIG?.GOOGLE_CLIENT_ID || "";

let accessToken = null;
let currentUser = null;

export function getAccessToken() {
  return accessToken;
}
export function setAccessToken(token) {
  accessToken = token;
}
export function getCurrentUser() {
  return currentUser;
}
export function clearSession() {
  accessToken = null;
  currentUser = null;
}

/**
 * Call once per page load. Returns the authenticated user, or null if
 * there is no valid session (caller should redirect to sign-in).
 */
export async function bootstrapSession() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
    if (!res.ok) {
      clearSession();
      return null;
    }
    const data = await res.json();
    accessToken = data.accessToken;
    currentUser = data.user;
    return currentUser;
  } catch {
    clearSession();
    return null;
  }
}

const ROLE_HOME = {
  super_admin: "/public/super-admin/index.html",
  agency_admin: "/public/agency/clients.html",
  client_admin: "/public/admin/dashboard.html",
  client_employee: "/public/employee/dashboard.html",
};

export function homeForRole(role) {
  return ROLE_HOME[role] || "/public/auth/index.html";
}

/**
 * Guards a role-specific page: this is a UX convenience only (redirects
 * to the right area) — the backend remains the actual authority on every
 * API call regardless of what this function decides. A role not in
 * `allowedRoles` is bounced to ITS OWN home page, never shown the
 * requested page even briefly (no flash of unauthorized content) — the
 * page's own main() must not render anything before this resolves.
 */
export async function requireRole(...allowedRoles) {
  const user = await bootstrapSession();
  if (!user) {
    window.location.replace("/public/auth/index.html");
    return null;
  }
  if (!allowedRoles.includes(user.role)) {
    window.location.replace(homeForRole(user.role));
    return null;
  }
  return user;
}

export async function logout() {
  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    /* proceed to redirect regardless */
  }
  clearSession();
  window.location.replace("/public/auth/index.html");
}

/**
 * Development-only sign-in detection: probes whether the backend's
 * dev-login route actually exists in its route table (it's registered
 * only when NODE_ENV !== "production" — see backend/src/routes/
 * auth.routes.js) rather than trusting any frontend-side flag. An
 * unknown route falls through to the backend's generic 404 handler; a
 * real dev-login route responds to a deliberately-invalid body with its
 * own 400 validation error. Either shape is a cheap, single request,
 * cached for the page's lifetime — never assumed, never hardcoded.
 */
let devBackendProbe = null;
export async function isDevBackend() {
  if (devBackendProbe) return devBackendProbe;
  devBackendProbe = fetch(`${API_BASE_URL}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
    .then((res) => res.status !== 404)
    .catch(() => false);
  return devBackendProbe;
}
