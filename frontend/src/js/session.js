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
  tenant_admin: "/public/admin/dashboard.html",
  tenant_employee: "/public/employee/dashboard.html",
};

export function homeForRole(role) {
  return ROLE_HOME[role] || "/public/auth/index.html";
}

/**
 * Guards a role-specific page: this is a UX convenience only (redirects
 * to the right area) — the backend remains the actual authority on every
 * API call regardless of what this function decides (§A of the spec).
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
