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

// Employees only ever see their own assigned leads; Tenant Admin sees the
// whole tenant. This one function is the single place that decision is
// made, and it's expressed as a query-scope object consumed directly by
// leadModel's WHERE clauses — never as a separate "check after fetching"
// step.
function scopeFor(actor) {
  return actor.role === "tenant_employee" ? { restrictToUserId: actor.userId } : {};
}

function serializeLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
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
 * are later steps, not built yet), so this is the one place duplicate
 * detection needs to live for now.
 */
async function createLead(tenantId, actor, body) {
  const clean = validateCreateLead(body);

  let sourceId = clean.sourceId;
  if (sourceId) {
    await leadSourceService.requireBelongsToTenant(tenantId, sourceId);
  } else {
    const manualSource = await leadSourceModel.findOrCreateManualSource(tenantId);
    sourceId = manualSource.id;
  }

  if (clean.productId) {
    await productService.requireBelongsToTenant(tenantId, clean.productId);
  }

  const customFields = await customFieldService.validateForLead(tenantId, clean.customFields);
  const normalizedPhone = normalizePhone(clean.phone);

  const created = await withTransaction(async (conn) => {
    let isDuplicate = false;
    let duplicateOfLeadId = null;

    if (normalizedPhone) {
      // FOR UPDATE inside the transaction — see leadModel for why this is
      // what actually prevents two concurrent creations with the same
      // phone number from both seeing "no duplicate yet".
      const earliest = await leadModel.findEarliestByPhoneForUpdate(conn, tenantId, normalizedPhone);
      if (earliest) {
        isDuplicate = true;
        duplicateOfLeadId = earliest.id;
      }
    }

    return leadModel.insert(conn, tenantId, {
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
      // authenticated tenant user could set an arbitrary metaLeadId,
      // which (via leads.meta_lead_id's platform-wide, non-tenant-scoped
      // UNIQUE index — required so Step 7's webhook idempotency check
      // works across tenants) let Tenant A pre-claim Tenant B's Meta
      // leadgen_id and silently swallow that lead when Meta's webhook
      // later delivered it — see the Step 10 regression test.
      metaLeadId: actor?.role === "meta_integration" && typeof body?.metaLeadId === "string" && body.metaLeadId.trim() ? body.metaLeadId.trim() : undefined,
      isDuplicate,
      duplicateOfLeadId,
    });
  });

  return serializeLead(created);
}

async function getLead(tenantId, actor, id) {
  const lead = await leadModel.findById(tenantId, id, scopeFor(actor));
  if (!lead) throw httpError("Lead not found.", 404);
  return serializeLead(lead);
}

async function listLeads(tenantId, actor, query = {}) {
  const { page, pageSize, offset } = parsePagination(query);

  const filters = {};
  if (query.statusId) filters.statusId = Number(query.statusId);
  if (query.sourceId) filters.sourceId = Number(query.sourceId);
  if (query.productId) filters.productId = Number(query.productId);
  // Only meaningful for an admin — an employee's results are already
  // pinned to themself by scopeFor(), so this filter is ignored for them
  // rather than silently letting them probe another employee's id.
  if (actor.role === "tenant_admin" && query.assignedTo) filters.assignedTo = Number(query.assignedTo);
  if (query.isDuplicate !== undefined) filters.isDuplicate = query.isDuplicate === "true";
  if (query.q) filters.q = String(query.q).trim().slice(0, 255);

  const scope = scopeFor(actor);
  const [rows, total] = await Promise.all([
    leadModel.list(tenantId, { ...scope, filters, limit: pageSize, offset }),
    leadModel.count(tenantId, { ...scope, filters }),
  ]);

  return {
    items: rows.map(serializeLead),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

async function updateLead(tenantId, actor, id, body) {
  const clean = validateUpdateLead(body);
  const scope = scopeFor(actor);

  if (clean.sourceId) await leadSourceService.requireBelongsToTenant(tenantId, clean.sourceId);
  if (clean.productId) await productService.requireBelongsToTenant(tenantId, clean.productId);

  const patch = { ...clean };
  if (clean.phone !== undefined) patch.phone = normalizePhone(clean.phone);
  if (clean.customFields !== undefined) {
    patch.customFields = await customFieldService.validateForLead(tenantId, clean.customFields);
  }

  const updated = await leadModel.updateFields(tenantId, id, patch, scope);
  if (!updated) throw httpError("Lead not found.", 404);
  return serializeLead(updated);
}

async function deleteLead(tenantId, id) {
  try {
    const deleted = await leadModel.remove(tenantId, id);
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
async function changeStatus(tenantId, actor, id, body) {
  const statusId = validateStatusChange(body);
  const scope = scopeFor(actor);

  const lead = await leadModel.findById(tenantId, id, scope);
  if (!lead) throw httpError("Lead not found.", 404);

  const targetStatus = await leadStatusService.requireBelongsToTenant(tenantId, statusId);
  const fromStatusId = lead.status_id;

  const queuedCapiEvent = await withTransaction(async (conn) => {
    const ok = await leadModel.updateStatus(conn, tenantId, id, statusId, scope);
    if (!ok) throw httpError("Lead not found.", 404);
    await leadStatusHistoryModel.create(conn, tenantId, {
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
    return metaCapiService.maybeQueueConversion(conn, tenantId, id, targetStatus);
  });

  if (queuedCapiEvent) metaCapiService.scheduleProcessing(queuedCapiEvent.id);

  return serializeLead(await leadModel.findById(tenantId, id, scope));
}

/**
 * §I: Tenant Admin only (enforced by route RBAC, not repeated here) — the
 * target employee/admin must exist in the same tenant. Writes an
 * `assignment`-type lead_activities row in the same transaction.
 */
async function assignLead(tenantId, actor, id, body) {
  const assignedTo = validateAssignment(body);

  const lead = await leadModel.findById(tenantId, id);
  if (!lead) throw httpError("Lead not found.", 404);

  let remarks = "Unassigned";
  if (assignedTo !== null) {
    const target = await userModel.findById(assignedTo);
    if (!target || target.tenant_id !== tenantId) {
      throw httpError("assignedTo must be a user in your own tenant.", 400);
    }
    if (!["tenant_admin", "tenant_employee"].includes(target.role_name)) {
      throw httpError("Leads can only be assigned to a Tenant Admin or Tenant Employee.", 400);
    }
    if (target.status !== "active") {
      throw httpError("Cannot assign a lead to an inactive or not-yet-activated account.", 400);
    }
    remarks = `Assigned to ${target.name} (${target.email})`;
  }

  await withTransaction(async (conn) => {
    const ok = await leadModel.updateAssignment(conn, tenantId, id, assignedTo);
    if (!ok) throw httpError("Lead not found.", 404);
    await leadActivityModel.create(conn, tenantId, {
      leadId: id,
      userId: actor.userId,
      type: "assignment",
      remarks,
      outcome: null,
    });
  });

  return serializeLead(await leadModel.findById(tenantId, id));
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
