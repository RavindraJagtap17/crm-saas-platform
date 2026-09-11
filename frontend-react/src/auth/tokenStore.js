/**
 * Access token storage — module-level, in-memory ONLY, never localStorage/
 * sessionStorage. Ported from the old frontend's session.js: the access
 * token must never be readable by an XSS payload out of browser storage.
 *
 * Unlike the old multi-page app (which re-bootstrapped on every full page
 * load via the httpOnly refresh cookie), this React SPA bootstraps the
 * session ONCE when the app mounts (see AuthContext) — client-side route
 * changes never reload the page, so there's no need to re-fetch on every
 * navigation. The refresh cookie is still what makes the session survive
 * an actual browser reload/reopen.
 */
let accessToken = null;

export function getAccessToken() {
  return accessToken;
}
export function setAccessToken(token) {
  accessToken = token;
}
export function clearAccessToken() {
  accessToken = null;
}
