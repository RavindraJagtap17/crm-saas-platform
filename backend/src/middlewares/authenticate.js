const { verifyAccessToken } = require("../utils/jwt");

/**
 * Verifies the access token's signature and expiry and sets req.user from
 * its claims. Deliberately does NOT hit the database on every request —
 * the access token is short-lived (~15 min) by design specifically so a
 * stateless check here is an acceptable trade-off; revocation of a
 * compromised session is handled at the refresh-token layer instead
 * (see authService.refreshSession / revokeSession), not by re-checking
 * the database on every authenticated request.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      sub: payload.sub,
      role: payload.role,
      tenantId: payload.tenantId,
      clientId: payload.clientId ?? null,
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
}

module.exports = authenticate;
