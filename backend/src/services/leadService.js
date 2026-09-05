const leadModel = require("../models/leadModel");
const leadActivityModel = require("../models/leadActivityModel");
const leadStatusHistoryModel = require("../models/leadStatusHistoryModel");
const leadSourceModel = require("../models/leadSourceModel");
const leadStatusService = require("./leadStatusService");
const leadSourceService = require("./leadSourceService");
const productService = require("./productService");
const customFieldService = require("./customFieldService");
const metaCapiService = require("./metaCapiService");
const userModel = require("../models/userModel");
const httpError = require("../utils/httpError");
const withTransaction = require("../utils/withTransaction");
const { normalizePhone } = require("../utils/phone");
const { parsePagination } = require("../utils/pagination");
const {
  validateCreateLead,
  validateUpdateLead,
  validateStatusChange,
  validateAssignment,
} = require("../validators/leadValidators");

// B2B2C restructure (Business Decision: Client Employee behavior change):
// a Client Employee now sees ALL of their client's leads, not just their
// own assigned ones — the old tenant_employee "assigned_to = self"
// restriction on LIST/GET/UPDATE is gone. What still differs by role is
// PERMISSION (only client_admin may assign/reassign — enforced by route
// RBAC, not here), not visibility. Kept as a named function (rather than
// inlined `{}`) so every call site's intent stays self-documenting and a
// future visibility rule has exactly one place to live.
function scopeFor(_actor) {
  return {};
}

function serializeLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    sourceId: row.source_id,
    productId: row.product_id,
    statusId: row.status_id,
    assignedTo: row.assigned_to,
    customFields: typeof row.custom_fields === "string" ? JSON.parse(row.custom_fields) : row.custom_fields,
    metaLeadId: row.meta_lead_id,
    isDuplicate: !!row.is_duplicate,
    duplicateOfLeadId: row.duplicate_of_lead_id,
    convertedAt: row.converted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * §C manual creation + §H duplicate detection, combined: every lead this
 * app can currently create goes through here (Meta/website-form ingestion
 * included), so this is the one place duplicate detection needs to live.
 */
async function createLead(clientId, actor, body) {
  const clean = validateCreateLead(body);

  let sourceId = clean.sourceId;
  if (sourceId) {
    await leadSourceService.requireBelongsToClient(clientId, sourceId);
  } else {
    const manualSource = await leadSourceModel.findOrCreateManualSource(clientId);
    sourceId = manualSource.id;
  }

  if (clean.productId) {
    await productService.requireBelongsToClient(clientId, clean.productId);
  }

  const customFields = await customFieldService.validateForLead(clientId, clean.customFields);
  const normalizedPhone = normalizePhone(clean.phone);

  const created = await withTransaction(async (conn) => {
    let isDuplicate = false;
    let duplicateOfLeadId = null;

    if (normalizedPhone) {
      // FOR UPDATE inside the transaction — see leadModel for why this is
      // what actually prevents two concurrent creations with the same
      // phone number from both seeing "no duplicate yet".
      const earliest = await leadModel.findEarliestByPhoneForUpdate(conn, clientId, normalizedPhone);
      if (earliest) {
        isDuplicate = true;
        duplicateOfLeadId = earliest.id;
      }
    }

    return leadModel.insert(conn, clientId, {
      name: clean.name ?? null,
      phone: normalizedPhone,
      email: clean.email ?? null,
      sourceId,
      productId: clean.productId ?? null,
      // Always starts with no status. Status is only ever set through
      // changeStatus() below (§K) — including the very first assignment —
      // so there is exactly one code path that can write status_id, and
      // it always writes a matching lead_status_history row.
      statusId: null,
      assignedTo: null, // §C / §I: new leads always start unassigned
      customFields,
      // Step 10 security fix: only ever set for the one trusted internal
      // caller (metaLeadService, which passes actor.role === "meta_integration"
      // — a synthetic role no authenticated request can ever carry, since
      // it's never issued by signAccessToken). Gating on `actor.role`
      // rather than on `body`'s shape is the actual fix — createLead IS
      // reachable directly from client input (POST /api/leads passes
      // req.body straight through, see lead.controller.js), so the
      // previous "never client-writable" premise was false: any
      // authenticated client user could set an arbitrary metaLeadId,
      // which (via leads.meta_lead_id's platform-wide, non-client-scoped
      // UNIQUE index — required so Step 7's webhook idempotency check
      // works across clients) let Client A pre-claim Client B's Meta
      // leadgen_id and silently swallow that lead when Meta's webhook
      // later delivered it — see the Step 10 regression test.
      metaLeadId: actor?.role === "meta_integration" && typeof body?.metaLeadId === "string" && body.metaLeadId.trim() ? body.metaLeadId.trim() : undefined,
      isDuplicate,
      duplicateOfLeadId,
    });
  });

  return serializeLead(created);
}

async function getLead(clientId, actor, id) {
  const lead = await leadModel.findById(clientId, id, scopeFor(actor));
  if (!lead) throw httpError("Lead not found.", 404);
  return serializeLead(lead);
}

async function listLeads(clientId, actor, query = {}) {
  const { page, pageSize, offset } = parsePagination(query);

  const filters = {};
  if (query.statusId) filters.statusId = Number(query.statusId);
  if (query.sourceId) filters.sourceId = Number(query.sourceId);
  if (query.productId) filters.productId = Number(query.productId);
  // Both roles can reach here now (an employee's results are no longer
  // pinned to themself — see scopeFor above) — assignedTo filtering is
  // just a normal query filter for either role.
  if (query.assignedTo) filters.assignedTo = Number(query.assignedTo);
  if (query.isDuplicate !== undefined) filters.isDuplicate = query.isDuplicate === "true";
  if (query.q) filters.q = String(query.q).trim().slice(0, 255);

  const scope = scopeFor(actor);
  const [rows, total] = await Promise.all([
    leadModel.list(clientId, { ...scope, filters, limit: pageSize, offset }),
    leadModel.count(clientId, { ...scope, filters }),
  ]);

  return {
    items: rows.map(serializeLead),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

async function updateLead(clientId, actor, id, body) {
  const clean = validateUpdateLead(body);
  const scope = scopeFor(actor);

  if (clean.sourceId) await leadSourceService.requireBelongsToClient(clientId, clean.sourceId);
  if (clean.productId) await productService.requireBelongsToClient(clientId, clean.productId);

  const patch = { ...clean };
  if (clean.phone !== undefined) patch.phone = normalizePhone(clean.phone);
  if (clean.customFields !== undefined) {
    patch.customFields = await customFieldService.validateForLead(clientId, clean.customFields);
  }

  const updated = await leadModel.updateFields(clientId, id, patch, scope);
  if (!updated) throw httpError("Lead not found.", 404);
  return serializeLead(updated);
}

async function deleteLead(clientId, id) {
  try {
    const deleted = await leadModel.remove(clientId, id);
    if (!deleted) throw httpError("Lead not found.", 404);
  } catch (err) {
    if (err.errno === 1451 || err.code === "ER_ROW_IS_REFERENCED_2") {
      throw httpError(
        "Cannot delete this lead — one or more other leads reference it as their duplicate original.",
        409
      );
    }
    throw err;
  }
}

/**
 * §D / §K: updates leads.status_id and writes a lead_status_history row
 * in the same transaction. No Meta CAPI triggering here — that's a later
 * step reading this same history table.
 */
async function changeStatus(clientId, actor, id, body) {
  const statusId = validateStatusChange(body);
  const scope = scopeFor(actor);

  const lead = await leadModel.findById(clientId, id, scope);
  if (!lead) throw httpError("Lead not found.", 404);

  const targetStatus = await leadStatusService.requireBelongsToClient(clientId, statusId);
  const fromStatusId = lead.status_id;

  const queuedCapiEvent = await withTransaction(async (conn) => {
    const ok = await leadModel.updateStatus(conn, clientId, id, statusId, scope);
    if (!ok) throw httpError("Lead not found.", 404);
    await leadStatusHistoryModel.create(conn, clientId, {
      leadId: id,
      fromStatusId,
      toStatusId: statusId,
      changedBy: actor.userId,
    });
    // Step 8 (§B): queuing is atomic with the status write itself — either
    // both land in this transaction or neither does. Sending is NOT done
    // here (§I: a Meta API failure must never roll back or delay the
    // status change) — see the scheduleProcessing() call below, which only
    // runs after this transaction has already committed successfully.
    return metaCapiService.maybeQueueConversion(conn, clientId, id, targetStatus);
  });

  if (queuedCapiEvent) metaCapiService.scheduleProcessing(queuedCapiEvent.id);

  return serializeLead(await leadModel.findById(clientId, id, scope));
}

/**
 * §I: Client Admin only (enforced by route RBAC, not repeated here) — the
 * target employee/admin must exist in the same client. Writes an
 * `assignment`-type lead_activities row in the same transaction.
 */
async function assignLead(clientId, actor, id, body) {
  const assignedTo = validateAssignment(body);

  const lead = await leadModel.findById(clientId, id);
  if (!lead) throw httpError("Lead not found.", 404);

  let remarks = "Unassigned";
  if (assignedTo !== null) {
    const target = await userModel.findById(assignedTo);
    if (!target || target.client_id !== clientId) {
      throw httpError("assignedTo must be a user in your own client.", 400);
    }
    if (!["client_admin", "client_employee"].includes(target.role_name)) {
      throw httpError("Leads can only be assigned to a Client Admin or Client Employee.", 400);
    }
    if (target.status !== "active") {
      throw httpError("Cannot assign a lead to an inactive or not-yet-activated account.", 400);
    }
    remarks = `Assigned to ${target.name} (${target.email})`;
  }

  await withTransaction(async (conn) => {
    const ok = await leadModel.updateAssignment(conn, clientId, id, assignedTo);
    if (!ok) throw httpError("Lead not found.", 404);
    await leadActivityModel.create(conn, clientId, {
      leadId: id,
      userId: actor.userId,
      type: "assignment",
      remarks,
      outcome: null,
    });
  });

  return serializeLead(await leadModel.findById(clientId, id));
}

module.exports = {
  createLead,
  getLead,
  listLeads,
  updateLead,
  deleteLead,
  changeStatus,
  assignLead,
  serializeLead,
  scopeFor,
};
