const jwt = require("jsonwebtoken");
const config = require("../config");

/**
 * The access token intentionally carries only what the approved
 * architecture calls for: who (sub), their role, and their scope context
 * — nothing else about the user is trusted from a token that's floating
 * around in frontend memory for up to 15 minutes.
 *
 * tenantId always means the AGENCY. For a client-level user (client_admin/
 * client_employee) that's resolved via clients.tenant_id at issuance time
 * (userModel.SELECT_WITH_ROLE's effective_tenant_id) — never their own
 * users.tenant_id column, which is always NULL for those roles by design.
 * clientId is null for every role except client_admin/client_employee.
 */
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role_name,
      tenantId: user.effective_tenant_id ?? user.tenant_id ?? null,
      clientId: user.client_id ?? null,
    },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiry }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

module.exports = { signAccessToken, verifyAccessToken };
