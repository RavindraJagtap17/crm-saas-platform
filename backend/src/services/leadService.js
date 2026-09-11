const leadModel = require("../models/leadModel");
const leadActivityModel = require("../models/leadActivityModel");
const leadStatusHistoryModel = require("../models/leadStatusHistoryModel");
const leadStatusModel = require("../models/leadStatusModel");
const leadSourceModel = require("../models/leadSourceModel");
const productModel = require("../models/productModel");
const customFieldModel = require("../models/customFieldModel");
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
  validateBulkLeadIds,
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

// Generic Lead Ingestion Foundation — replaces the old hardcoded
// `actor.role === "meta_integration"` string comparison with a small,
// extensible set. Every member is a SYNTHETIC role: never issued by
// signAccessToken (see jwt.js), so no authenticated HTTP request —
// Client Admin, Client Employee, anyone — can ever carry one; only
// trusted internal service code sets `actor.role` to one of these,
// exactly as metaLeadService already does for "meta_integration".
// "integration" is the one new addition, used by ingestionService.js for
// every future non-Meta provider — Meta's own call site is completely
// untouched (still passes "meta_integration", still hits the same
// metaLeadId branch below, unchanged).
const TRUSTED_INTEGRATION_ACTOR_ROLES = new Set(["meta_integration", "integration"]);

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
      // Step 10 security fix, now provider-neutral: only ever set for a
      // trusted internal caller (TRUSTED_INTEGRATION_ACTOR_ROLES above).
      // Gating on `actor.role` rather than on `body`'s shape is the
      // actual fix — createLead IS reachable directly from client input
      // (POST /api/leads passes req.body straight through, see
      // lead.controller.js), so "never client-writable" would otherwise
      // be false: any authenticated client user could set an arbitrary
      // metaLeadId, which (via leads.meta_lead_id's platform-wide,
      // non-client-scoped UNIQUE index — required so the Meta webhook's
      // own idempotency check works across clients) would let Client A
      // pre-claim Client B's Meta leadgen_id and silently swallow that
      // lead when Meta's webhook later delivered it. Still exactly the
      // one column that exists (leads.meta_lead_id) — a non-Meta
      // provider's own external id is never written here at all; that
      // idempotency lives one layer up, in integration_events (see
      // ingestionService.js), which is what actually gates whether this
      // function is even called a second time for the same external lead.
      metaLeadId:
        TRUSTED_INTEGRATION_ACTOR_ROLES.has(actor?.role) && typeof body?.metaLeadId === "string" && body.metaLeadId.trim()
          ? body.metaLeadId.trim()
          : undefined,
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

// Shared by listLeads and both export functions (§ Lead CSV Export) —
// exported data must use the exact same filtering semantics as the Leads
// page, so there is exactly one place that turns a query object into
// leadModel filters, never a second parallel implementation.
function parseLeadFilters(query = {}) {
  const filters = {};
  if (query.statusId) filters.statusId = Number(query.statusId);
  if (query.sourceId) filters.sourceId = Number(query.sourceId);
  if (query.productId) filters.productId = Number(query.productId);
  // Both roles can reach here now (an employee's results are no longer
  // pinned to themself — see scopeFor above) — assignedTo filtering is
  // just a normal query filter for either role.
  if (query.assignedTo) filters.assignedTo = Number(query.assignedTo);
  if (query.unassignedOnly === "true") filters.unassignedOnly = true;
  if (query.isDuplicate !== undefined) filters.isDuplicate = query.isDuplicate === "true";
  if (query.q) filters.q = String(query.q).trim().slice(0, 255);
  return filters;
}

async function listLeads(clientId, actor, query = {}) {
  const { page, pageSize, offset } = parsePagination(query);
  const filters = parseLeadFilters(query);
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

/**
 * Verifies every one of `leadIds` is a real lead belonging to `clientId` —
 * the ONE ownership check every bulk action needs, done as a single
 * set-based query (leadModel.findByIdsForClient) rather than N per-id
 * lookups. `found.length !== ids.length` means at least one id doesn't
 * exist or belongs to a different client — the caller never learns which
 * (a leaked "this one belongs to another client" vs "this one doesn't
 * exist" distinction would itself be a minor cross-client information
 * leak), and the WHOLE batch is rejected rather than silently dropping the
 * bad id(s) and processing the rest (§9: "mixed-client request must fail
 * safely" — safely here means as a unit, not partially).
 */
async function requireAllLeadsBelongToClient(clientId, ids) {
  const found = await leadModel.findByIdsForClient(clientId, ids);
  if (found.length !== ids.length) {
    throw httpError("One or more selected leads were not found.", 400);
  }
  return new Map(found.map((l) => [l.id, l]));
}

/**
 * Bulk Assign — Client Admin only (route RBAC, matching assignLead's own
 * single-lead restriction exactly; this is NOT a new permission, only a
 * batched form of one that already exists). The target employee is
 * resolved and validated exactly once for the whole batch (same
 * userModel.findById + client/role/active checks assignLead already
 * makes) — not re-validated per lead, since it's the same target for
 * every row. True all-or-nothing: one transaction wraps every row's
 * assignment write + its companion lead_activities row, exactly mirroring
 * what a human clicking "Reassign" on each lead individually would
 * produce — if any single row fails (only realistically a lead deleted by
 * someone else in the narrow window between the ownership check above and
 * this transaction), the whole transaction rolls back rather than leaving
 * some leads reassigned and others not.
 */
async function bulkAssignLeads(clientId, actor, body) {
  const ids = validateBulkLeadIds(body?.leadIds);
  const assignedTo = validateAssignment(body);
  await requireAllLeadsBelongToClient(clientId, ids);

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
    for (const id of ids) {
      const ok = await leadModel.updateAssignment(conn, clientId, id, assignedTo);
      if (!ok) throw httpError(`Lead ${id} could not be updated — it may have just been deleted.`, 409);
      await leadActivityModel.create(conn, clientId, { leadId: id, userId: actor.userId, type: "assignment", remarks, outcome: null });
    }
  });

  return { assignedCount: ids.length, leadIds: ids };
}

/**
 * Bulk Status Change — open to both client_admin and client_employee,
 * matching changeStatus's own route (no additional requireRole beyond the
 * router's base client_admin/client_employee gate) exactly. Every row
 * gets the SAME lead_status_history write and the SAME Meta CAPI
 * queue-if-final check a single-lead status change already makes — no
 * shortcut, no bypassed history, just the same per-lead work repeated
 * inside one transaction. CAPI SENDING (not queueing) still happens after
 * commit, matching changeStatus's own "a Meta API failure must never roll
 * back or delay the status change" comment.
 */
async function bulkChangeStatus(clientId, actor, body) {
  const ids = validateBulkLeadIds(body?.leadIds);
  const statusId = validateStatusChange(body);
  const leadById = await requireAllLeadsBelongToClient(clientId, ids);
  const targetStatus = await leadStatusService.requireBelongsToClient(clientId, statusId);

  const queuedCapiEvents = [];
  await withTransaction(async (conn) => {
    for (const id of ids) {
      const fromStatusId = leadById.get(id).status_id;
      const ok = await leadModel.updateStatus(conn, clientId, id, statusId);
      if (!ok) throw httpError(`Lead ${id} could not be updated — it may have just been deleted.`, 409);
      await leadStatusHistoryModel.create(conn, clientId, { leadId: id, fromStatusId, toStatusId: statusId, changedBy: actor.userId });
      const queued = await metaCapiService.maybeQueueConversion(conn, clientId, id, targetStatus);
      if (queued) queuedCapiEvents.push(queued);
    }
  });

  queuedCapiEvents.forEach((event) => metaCapiService.scheduleProcessing(event.id));

  return { updatedCount: ids.length, leadIds: ids };
}

// CSV Export — a first version deliberately kept synchronous (build the
// whole CSV in memory, send it in one response): a per-Client B2B2C CRM's
// realistic lead volume is nowhere near where a streaming/async export
// job would earn its complexity, and MAX_EXPORT_ROWS keeps the worst case
// bounded (10,000 rows x ~12 columns is a few MB of string building, not
// a memory concern). Never silently truncates: if the filtered count
// exceeds the cap, the request is rejected with the real count so the
// caller knows to narrow their filters, rather than exporting a
// suspiciously-round, silently-incomplete file.
const MAX_EXPORT_ROWS = 10000;

const EXPORT_HEADERS = [
  "Lead ID",
  "Name",
  "Phone",
  "Email",
  "Status",
  "Source",
  "Product",
  "Assigned Employee",
  "Is Duplicate",
  "Duplicate Of Lead ID",
  "Converted At",
  "Created At",
  "Updated At",
];

function formatDateForCsv(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Turns a set of raw lead rows (leadModel's own row shape — snake_case,
 * not serializeLead's camelCase — see findByIdsForClient/list) into CSV
 * headers+rows. Status/source/product/employee NAMES are resolved via
 * four small reference-table queries (one each, by clientId — never per
 * lead) rather than joining them into the list query itself, so the
 * shared, paginated leadModel.list() used by the regular Leads page stays
 * untouched. Custom fields: one column per ACTIVE custom field definition
 * for this client (field values are already flat text/select/number/date/
 * textarea scalars per custom_field_definitions.field_type — nothing here
 * invents a new serialization for them, it just reads the same
 * leads.custom_fields JSON object the rest of the app already reads).
 */
async function buildExportRows(clientId, leads) {
  const [statuses, sources, products, users, customFieldDefs] = await Promise.all([
    leadStatusModel.list(clientId),
    leadSourceModel.list(clientId),
    productModel.list(clientId, { includeInactive: true }),
    userModel.listByClient(clientId),
    customFieldModel.list(clientId, { includeInactive: false }),
  ]);
  const statusById = new Map(statuses.map((s) => [s.id, s.name]));
  const sourceById = new Map(sources.map((s) => [s.id, s.name]));
  const productById = new Map(products.map((p) => [p.id, p.name]));
  const userById = new Map(users.map((u) => [u.id, u.name]));

  const headers = [...EXPORT_HEADERS, ...customFieldDefs.map((f) => f.label)];
  const rows = leads.map((lead) => {
    const customFields = (typeof lead.custom_fields === "string" ? JSON.parse(lead.custom_fields) : lead.custom_fields) || {};
    const base = [
      lead.id,
      lead.name || "",
      lead.phone || "",
      lead.email || "",
      statusById.get(lead.status_id) || "",
      sourceById.get(lead.source_id) || "",
      productById.get(lead.product_id) || "",
      userById.get(lead.assigned_to) || "",
      lead.is_duplicate ? "Yes" : "No",
      lead.duplicate_of_lead_id || "",
      formatDateForCsv(lead.converted_at),
      formatDateForCsv(lead.created_at),
      formatDateForCsv(lead.updated_at),
    ];
    const customValues = customFieldDefs.map((f) => (customFields[f.field_key] ?? ""));
    return [...base, ...customValues];
  });
  return { headers, rows };
}

/**
 * Export Filtered — SAME filters as the Leads list (parseLeadFilters,
 * reused verbatim), but ignoring pagination entirely: exports every
 * matching lead, not just the current page. Counts first (leadModel.count,
 * already used by listLeads — no new query) so an over-limit request is
 * rejected before ever running the expensive list query, with the real
 * total in the error message.
 */
async function exportFilteredLeads(clientId, actor, query = {}) {
  const filters = parseLeadFilters(query);
  const scope = scopeFor(actor);

  const total = await leadModel.count(clientId, { ...scope, filters });
  if (total === 0) return { headers: EXPORT_HEADERS, rows: [] };
  if (total > MAX_EXPORT_ROWS) {
    throw httpError(
      `${total} leads match these filters, which is more than the ${MAX_EXPORT_ROWS}-row export limit. Narrow your filters and try again.`,
      400,
      "EXPORT_TOO_LARGE"
    );
  }

  const leads = await leadModel.list(clientId, { ...scope, filters, limit: total, offset: 0 });
  return buildExportRows(clientId, leads);
}

/**
 * Export Selected — reuses the exact same bulk-selection validation/
 * ownership-check bulkAssignLeads/bulkChangeStatus already use
 * (validateBulkLeadIds bounds it at MAX_BULK_LEADS=100; a mixed-Client
 * batch is rejected as a whole, nothing exported). Row order follows the
 * caller's own leadIds order (their selection, top to bottom in the UI),
 * not the DB's arbitrary IN(...) return order.
 */
async function exportSelectedLeads(clientId, actor, body) {
  const ids = validateBulkLeadIds(body?.leadIds);
  const leadById = await requireAllLeadsBelongToClient(clientId, ids);
  const leads = ids.map((id) => leadById.get(id));
  return buildExportRows(clientId, leads);
}

module.exports = {
  createLead,
  getLead,
  listLeads,
  updateLead,
  deleteLead,
  changeStatus,
  assignLead,
  bulkAssignLeads,
  bulkChangeStatus,
  exportFilteredLeads,
  exportSelectedLeads,
  serializeLead,
  scopeFor,
  TRUSTED_INTEGRATION_ACTOR_ROLES,
};
