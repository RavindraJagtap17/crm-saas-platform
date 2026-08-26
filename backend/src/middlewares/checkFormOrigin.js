const config = require("../config");
const httpError = require("../utils/httpError");

function hostnameOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Must run after resolveFormKey (needs req.form.allowed_domains). §F.
 *
 * Two genuinely different embed paths reach this middleware, and they
 * present different Origin values:
 *
 * - Script embed: the widget's fetch() executes in the HOST PAGE's
 *   origin context, so Origin is the site actually embedding it — this
 *   is checked against that tenant's own allowed_domains list.
 *
 * - Iframe embed: the form page is a document served FROM THIS APP, so
 *   its own fetch() always carries Origin = this app's own frontend
 *   origin, regardless of which third-party site put it in an <iframe>.
 *   There is no standard browser signal on a same-origin fetch that
 *   reveals the PARENT page's domain, so the tenant's per-site allowlist
 *   cannot apply to iframe submissions — this is a real, inherent
 *   limitation of iframes, not an oversight, and is exactly why the spec
 *   treats iframe as the fallback rather than the primary path. A
 *   request whose Origin matches this app's own configured FRONTEND_URL
 *   is trusted on that basis instead — the real gate for iframe usage is
 *   that the formKey itself is a 32-character random value, never
 *   published anywhere public, obtained only from the Tenant Admin UI.
 *
 * Local/direct testing (curl, Postman, no browser): browsers are the only
 * clients that attach Origin/Referer automatically, so a tool-driven
 * request usually has neither. Outside production, that's allowed through
 * to the other checks (formKey validity, honeypot, rate limit) so the
 * endpoint stays testable without a real browser. In production, a
 * missing Origin AND Referer is rejected — a genuine browser-driven
 * submission (script or iframe) always sends at least one.
 */
function checkFormOrigin(req, res, next) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const candidate = origin || referer;

  if (!candidate) {
    if (config.isProduction) {
      return next(httpError("This request could not be verified. Please submit the form from a browser.", 403, "ORIGIN_REQUIRED"));
    }
    return next();
  }

  const hostname = hostnameOf(candidate);
  if (!hostname) {
    return next(httpError("This request could not be verified.", 403, "ORIGIN_INVALID"));
  }

  const ownFrontendHostname = hostnameOf(config.frontendUrl);
  if (hostname === ownFrontendHostname) {
    return next(); // legitimate iframe self-submission — see doc comment above
  }

  const allowed = (req.form.allowed_domains || []).map((d) => String(d).toLowerCase());
  if (!allowed.includes(hostname)) {
    return next(httpError("This website is not authorized to submit this form.", 403, "ORIGIN_NOT_ALLOWED"));
  }

  next();
}

module.exports = checkFormOrigin;
