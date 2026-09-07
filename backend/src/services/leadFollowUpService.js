const leadFollowUpModel = require("../models/leadFollowUpModel");
const leadModel = require("../models/leadModel");
const leadActivityModel = require("../models/leadActivityModel");
const userModel = require("../models/userModel");
const httpError = require("../utils/httpError");
const withTransaction = require("../utils/withTransaction");
const { parsePagination } = require("../utils/pagination");
const {
  validateCreateFollowUp,
  validateUpdateFollowUp,
  parseListQuery,
} = require("../validators/leadFollowUpValidators");

/**
 * Follow-up scheduling. Leads themselves stay visible to a Client Employee
 * client-wide (leadService.scopeFor — unchanged, untouched by this file),
 * but a FOLLOW-UP is a personal work item, not shared lead data: "should
 * see only follow-ups assigned to them" (confirmed business rule for this
 * feature). So, unlike leadService.scopeFor (which always returns `{}`),
 * an employee's scope here is always `{ restrictToUserId: actor.userId }`
 * — applied uniformly to list/get/update/complete/cancel, and forced
 * regardless of any assignedTo the caller passes, so a query param can
 * never widen an employee's own view. Client Admin's scope is always `{}`
 * (client-wide), exactly like leadService's Admin behavior.
 *
 * assigning follow-ups mirrors leadService.assignLead's own boundary: only
 * a Client Admin may hand a follow-up to someone OTHER than themselves. An
 * employee creating/rescheduling a follow-up may only ever target
 * themselves — attempting to name another user is rejected with 403, not
 * silently overridden, so the caller gets a clear signal rather than a
 * surprising result.
 */
function scopeFor(actor) {
  return actor.role === "client_employee" ? { restrictToUserId: actor.userId } : {};
}

function serialize(row) {
  if (!row) return null;
  const scheduledAt = row.scheduled_at instanceof Date ? row.scheduled_at : new Date(row.scheduled_at);
  return {
    id: row.id,
    clientId: row.client_id,
    leadId: row.lead_id,
    leadName: row.lead_name,
    leadPhone: row.lead_phone,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name,
    assignedToEmail: row.assigned_to_email,
    scheduledAt: row.scheduled_at,
    status: row.status,
    // Derived, never stored (§9) — a completed/cancelled row is never
    // "overdue" regardless of how far in the past its scheduled_at is.
    isOverdue: row.status === "pending" && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() < Date.now(),
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    completedByName: row.completed_by_name,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Shared by create and update: an employee may only ever target
// themselves; a Client Admin may target any active client_admin/
// client_employee in their own client — the exact same rule (and the same
// userModel.findByIdForClient lookup) leadService.assignLead already uses
// for a lead's own assigned_to.
async function requireAssignable(clientId, actor, assignedTo) {
  if (actor.role === "client_employee" && assignedTo !== actor.userId) {
    throw httpError("You can only schedule follow-ups assigned to yourself.", 403);
  }
  const target = await userModel.findByIdForClient(clientId, assignedTo);
  if (!target) throw httpError("assignedTo must be a user in your own client.", 400);
  if (!["client_admin", "client_employee"].includes(target.role_name)) {
    throw httpError("Follow-ups can only be assigned to a Client Admin or Client Employee.", 400);
  }
  if (target.status !== "active") {
    throw httpError("Cannot assign a follow-up to an inactive or not-yet-activated account.", 400);
  }
}

async function createForLead(clientId, actor, leadId, body) {
  // leadService.scopeFor(actor) is always `{}` — a follow-up can be
  // scheduled against any lead the caller can see, matching this
  // project's confirmed "employee sees every client lead" rule. Only the
  // FOLLOW-UP's own visibility is personal, not the underlying lead's.
  const lead = await leadModel.findById(clientId, leadId, {});
  if (!lead) throw httpError("Lead not found.", 404);

  const clean = validateCreateFollowUp(body);
  await requireAssignable(clientId, actor, clean.assignedTo);

  const created = await leadFollowUpModel.insert(null, clientId, {
    leadId,
    assignedTo: clean.assignedTo,
    scheduledAt: clean.scheduledAt,
    notes: clean.notes,
    createdBy: actor.userId,
  });
  return serialize({ ...created, lead_name: lead.name, lead_phone: lead.phone });
}

async function getFollowUp(clientId, actor, id) {
  const row = await leadFollowUpModel.findById(clientId, id, scopeFor(actor));
  if (!row) throw httpError("Follow-up not found.", 404);
  // findById doesn't join lead/user names (it's the single-row primitive
  // shared by every mutation below) — fetch them for display here, the
  // one read-for-display call site that needs them.
  const [lead, assignee] = await Promise.all([
    leadModel.findById(clientId, row.lead_id, {}),
    userModel.findByIdForClient(clientId, row.assigned_to),
  ]);
  return serialize({ ...row, lead_name: lead?.name, lead_phone: lead?.phone, assigned_to_name: assignee?.name, assigned_to_email: assignee?.email });
}

async function listFollowUps(clientId, actor, query = {}) {
  const { page, pageSize, offset } = parsePagination(query);
  const filters = parseListQuery(query);
  const scope = scopeFor(actor);

  const [rows, total] = await Promise.all([
    leadFollowUpModel.list(clientId, { ...scope, filters, limit: pageSize, offset }),
    leadFollowUpModel.count(clientId, { ...scope, filters }),
  ]);

  return {
    items: rows.map(serialize),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

async function listForLead(clientId, actor, leadId) {
  const lead = await leadModel.findById(clientId, leadId, {});
  if (!lead) throw httpError("Lead not found.", 404);
  const rows = await leadFollowUpModel.listForLead(clientId, leadId, scopeFor(actor));
  return rows.map((r) => serialize({ ...r, lead_name: lead.name, lead_phone: lead.phone }));
}

async function updateFollowUp(clientId, actor, id, body) {
  const scope = scopeFor(actor);
  const existing = await leadFollowUpModel.findById(clientId, id, scope);
  if (!existing) throw httpError("Follow-up not found.", 404);
  if (existing.status !== "pending") {
    throw httpError(`This follow-up is already '${existing.status}' and cannot be modified.`, 409, "FOLLOW_UP_NOT_PENDING");
  }

  const patch = validateUpdateFollowUp(body);
  if (patch.assignedTo !== undefined) {
    await requireAssignable(clientId, actor, patch.assignedTo);
  }

  const updated = await leadFollowUpModel.updateFields(clientId, id, patch, scope);
  if (!updated) {
    // Lost a race with a concurrent complete/cancel between the read
    // above and this write — report the conflict plainly, matching
    // userService.setStatus's own ACCOUNT_STATE_CHANGED precedent.
    throw httpError("This follow-up was just completed or cancelled and can no longer be modified.", 409, "FOLLOW_UP_STATE_CHANGED");
  }
  return getFollowUp(clientId, actor, id);
}

/**
 * Completing writes a `follow_up`-type lead_activities row in the same
 * transaction (§4) — a NEW activity type value, added the exact same way
 * leadService.assignLead already adds "assignment": never listed in
 * leadValidators' client-postable ACTIVITY_TYPES, only ever written here
 * as a server-generated side effect. No follow-up data is duplicated onto
 * the activity beyond a short human-readable remark — the follow-up row
 * itself remains the source of truth.
 */
async function completeFollowUp(clientId, actor, id) {
  const scope = scopeFor(actor);
  const existing = await leadFollowUpModel.findById(clientId, id, scope);
  if (!existing) throw httpError("Follow-up not found.", 404);
  if (existing.status !== "pending") {
    throw httpError(`This follow-up is already '${existing.status}' and cannot be completed again.`, 409, "FOLLOW_UP_NOT_PENDING");
  }

  await withTransaction(async (conn) => {
    const ok = await leadFollowUpModel.complete(conn, clientId, id, actor.userId, scope);
    if (!ok) throw httpError("This follow-up was just completed or cancelled and can no longer be completed.", 409, "FOLLOW_UP_STATE_CHANGED");
    await leadActivityModel.create(conn, clientId, {
      leadId: existing.lead_id,
      userId: actor.userId,
      type: "follow_up",
      remarks: existing.notes ? `Follow-up completed: ${existing.notes}` : "Follow-up completed",
      outcome: null,
    });
  });

  return getFollowUp(clientId, actor, id);
}

async function cancelFollowUp(clientId, actor, id) {
  const scope = scopeFor(actor);
  const existing = await leadFollowUpModel.findById(clientId, id, scope);
  if (!existing) throw httpError("Follow-up not found.", 404);
  if (existing.status !== "pending") {
    throw httpError(`This follow-up is already '${existing.status}' and cannot be cancelled.`, 409, "FOLLOW_UP_NOT_PENDING");
  }

  const ok = await leadFollowUpModel.cancel(clientId, id, scope);
  if (!ok) throw httpError("This follow-up was just completed or cancelled and can no longer be cancelled.", 409, "FOLLOW_UP_STATE_CHANGED");
  return getFollowUp(clientId, actor, id);
}

module.exports = {
  scopeFor,
  serialize,
  createForLead,
  getFollowUp,
  listFollowUps,
  listForLead,
  updateFollowUp,
  completeFollowUp,
  cancelFollowUp,
};
