const jwt = require("jsonwebtoken");
const config = require("../config");

/**
 * The access token intentionally carries only what the approved
 * architecture calls for: who (sub), their role, and their tenant context
 * — nothing else about the user is trusted from a token that's floating
 * around in frontend memory for up to 15 minutes.
 */
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role_name,
      tenantId: user.tenant_id ?? null,
    },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiry }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

module.exports = { signAccessToken, verifyAccessToken };
