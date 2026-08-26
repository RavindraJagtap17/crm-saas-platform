const userModel = require("../models/userModel");
const roleModel = require("../models/roleModel");
const tenantModel = require("../models/tenantModel");
const httpError = require("../utils/httpError");
const { validateInvite, validateStatusChange } = require("../validators/userValidators");

function serialize(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    role: user.role_name,
    status: user.status,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

async function list(tenantId) {
  const users = await userModel.listByTenant(tenantId);
  return users.map(serialize);
}

/**
 * §9 of the Final Specification: employee_limit is checked against
 * invited + active tenant_employee seats specifically — see
 * userModel.countEmployeeSeatsUsed for why additional tenant_admin
 * accounts aren't counted against it.
 */
async function invite(tenantId, body) {
  const clean = validateInvite(body);

  const existing = await userModel.findByEmail(clean.email);
  if (existing) {
    throw httpError("An account already exists for this email.", 409, "ACCOUNT_EXISTS");
  }

  if (clean.role === "tenant_employee") {
    const tenant = await tenantModel.findById(tenantId);
    const used = await userModel.countEmployeeSeatsUsed(tenantId);
    if (used >= tenant.employee_limit) {
      throw httpError(
        `Employee limit reached (${used}/${tenant.employee_limit}). Ask your platform administrator to increase it.`,
        409,
        "EMPLOYEE_LIMIT_REACHED"
      );
    }
  }

  const role = await roleModel.findByName(clean.role);
  const created = await userModel.createInvited(tenantId, { email: clean.email, name: clean.name, roleId: role.id });
  return serialize(created);
}

async function setStatus(tenantId, id, body) {
  const status = validateStatusChange(body);
  const updated = await userModel.setStatus(tenantId, id, status);
  if (!updated) throw httpError("User not found.", 404);
  return serialize(updated);
}

module.exports = { list, invite, setStatus, serialize };
