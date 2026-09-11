const crypto = require("crypto");
const { parse } = require("csv-parse/sync");
const leadModel = require("../models/leadModel");
const leadStatusModel = require("../models/leadStatusModel");
const leadSourceModel = require("../models/leadSourceModel");
const productModel = require("../models/productModel");
const customFieldModel = require("../models/customFieldModel");
const userModel = require("../models/userModel");
const clientModel = require("../models/clientModel");
const auditLogModel = require("../models/auditLogModel");
const leadService = require("./leadService");
const httpError = require("../utils/httpError");
const logger = require("../utils/logger");
const { normalizePhone } = require("../utils/phone");
const { isLikelyEmail } = require("../validators/primitives");
const { validateLeadCustomFields } = require("../validators/customFieldValidators");

/**
 * CSV Import — a safety-first two-step preview/confirm flow (§ Client
 * Admin — CSV Import of Leads). Deliberately reuses THREE existing,
 * already-transactional service functions per row — leadService.
 * createLead, .changeStatus, .assignLead — rather than inventing a
 * parallel "import creates a lead differently" path. This is not a
 * stylistic choice: createLead() hard-codes status_id/assigned_to to NULL
 * on every insert (see its own comment — "status is only ever set through
 * changeStatus(), which always writes lead_status_history") and strips
 * both from any client-supplied body. There is no lower-level way to
 * create a lead WITH a status/assignment already set that doesn't also
 * skip lead_status_history/lead_activities — so a CSV row that specifies
 * a Status or Assigned Employee is imported as create -> changeStatus ->
 * assignLead, the exact sequence a human would perform by hand, each step
 * producing the exact same history/activity rows a human's own action
 * would.
 */

// ---- File/row/column limits (Phase 4) ----
// MAX_IMPORT_FILE_SIZE lives in middlewares/csvUpload.js (multer needs it
// before this module ever sees the request). The three limits below are
// smaller than CSV Export's MAX_EXPORT_ROWS=10000 deliberately: import does
// far more work per row (multiple name->id resolutions, a duplicate check,
// and an actual multi-step write), and the full row set has to round-trip
// through this process's own memory between preview and confirm (see
// pendingImports below) rather than just being read once and streamed out.
// 1000 rows comfortably covers a realistic single-import batch for a
// per-Client CRM without that round-trip becoming large.
const MAX_IMPORT_ROWS = 1000;
const MAX_IMPORT_COLUMNS = 50;
const MAX_CELL_LENGTH = 2000;

// How many classified rows the PREVIEW response actually returns to the
// browser (Phase 12: "do not render thousands of preview rows... the
// server retains complete validation results"). The full classification
// is still computed and used for the summary counts; only the row-level
// detail table is bounded.
const PREVIEW_DISPLAY_LIMIT = 100;

// One-time import tokens (Phase 16 idempotency), held in process memory
// only — NOT a database table. Phase 23 explicitly asks to justify this
// rather than default to a schema change: a persistent import-job table
// would need to survive a restart and be queryable, neither of which this
// feature needs — a preview that's still "pending" when the process
// restarts SHOULD be treated as gone (the user re-uploads), and nothing
// here needs to be visible outside the single request that created it.
// What's stored is the RAW parsed rows only (small strings), never the
// classification result — confirm always re-classifies against current
// data (Phase 3: never trust the preview blindly), so caching the
// classification itself would be actively wrong to reuse.
const pendingImports = new Map();
const IMPORT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function pruneExpiredImports() {
  const cutoff = Date.now() - IMPORT_TOKEN_TTL_MS;
  for (const [token, entry] of pendingImports) {
    if (entry.createdAt < cutoff) pendingImports.delete(token);
  }
}

// Exact same vocabulary CSV Export produces (leadService.EXPORT_HEADERS) —
// an exported file should round-trip back through import recognizing its
// own columns, and there is no second naming scheme to keep in sync.
const STANDARD_COLUMNS = new Set(["Name", "Phone", "Email", "Status", "Source", "Product", "Assigned Employee"]);
// Recognized but never imported — writing any of these from a CSV would
// mean a Lead ID in the file could silently retarget an existing lead, or
// a client-supplied Created At could misrepresent when a lead actually
// arrived. Phase 6 is explicit: create NEW leads only, never update an
// existing one via a CSV-supplied id.
const IGNORED_COLUMNS = new Set(["Lead ID", "Is Duplicate", "Duplicate Of Lead ID", "Converted At", "Created At", "Updated At"]);

function parseCsvBuffer(buffer) {
  let records;
  try {
    // columns:true uses row 1 as headers and returns objects keyed by
    // header name — exactly the shape classification needs, and it's
    // csv-parse (not a hand-rolled split(',')) doing the actual RFC4180
    // work: quoted fields, escaped quotes, embedded commas/newlines,
    // CRLF/LF. bom:true strips a leading UTF-8 BOM (Excel's own default
    // CSV export includes one) before parsing. relax_column_count is
    // deliberately left at its default (false) — a row with a different
    // field count than the header is exactly the "malformed CSV" case
    // that should be rejected up front, not silently misaligned.
    records = parse(buffer, { columns: true, skip_empty_lines: true, bom: true, trim: true });
  } catch (err) {
    throw httpError(`Could not parse this file as CSV: ${err.message}`, 400, "IMPORT_PARSE_ERROR");
  }
  if (records.length === 0) throw httpError("The uploaded file has no data rows.", 400, "IMPORT_EMPTY");
  if (records.length > MAX_IMPORT_ROWS) {
    throw httpError(
      `This file has ${records.length} rows, which is more than the ${MAX_IMPORT_ROWS}-row import limit. Split it into smaller files.`,
      400,
      "IMPORT_TOO_MANY_ROWS"
    );
  }
  const headers = Object.keys(records[0]);
  if (headers.length > MAX_IMPORT_COLUMNS) {
    throw httpError(`This file has ${headers.length} columns, which is more than the ${MAX_IMPORT_COLUMNS}-column limit.`, 400, "IMPORT_TOO_MANY_COLUMNS");
  }
  return records;
}

// Column-level plan, computed once per import (not per row): which
// headers are real lead fields, which are recognized-but-ignored, which
// map to one of this Client's currently-ACTIVE custom field definitions
// (matching customFieldService.validateForLead's own active-only rule),
// and which are simply not recognized at all. Unmapped/ignored columns
// become file-level warnings (Phase 9's "unmapped columns appear as
// warnings and are ignored" default), not a per-row repeat of the same
// notice for every single row.
function planColumns(headers, customFieldDefs) {
  const customFieldByLabel = new Map(customFieldDefs.map((f) => [f.label, f]));
  const columnPlan = [];
  const fileWarnings = [];
  for (const header of headers) {
    if (STANDARD_COLUMNS.has(header)) {
      columnPlan.push({ header, kind: "standard" });
    } else if (IGNORED_COLUMNS.has(header)) {
      columnPlan.push({ header, kind: "ignored" });
      fileWarnings.push(`Column "${header}" is read-only and was ignored — it never creates or updates a lead.`);
    } else if (customFieldByLabel.has(header)) {
      columnPlan.push({ header, kind: "custom", def: customFieldByLabel.get(header) });
    } else {
      columnPlan.push({ header, kind: "unmapped" });
      fileWarnings.push(`Column "${header}" is not a recognized field or active custom field for your Client and was ignored.`);
    }
  }
  return { columnPlan, fileWarnings };
}

function classifyRow(raw, rowNumber, ref) {
  const errors = [];

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.length > MAX_CELL_LENGTH) {
      errors.push(`Column "${key}" is too long (max ${MAX_CELL_LENGTH} characters).`);
    }
  }

  const name = (raw.Name || "").trim() || null;
  const phone = normalizePhone(raw.Phone) || null;
  const email = (raw.Email || "").trim() || null;

  if (!name && !phone && !email) errors.push("At least one of Name, Phone, or Email is required.");
  if (email && !isLikelyEmail(email)) errors.push(`"${email}" is not a valid email address.`);

  let statusId = null;
  const statusRaw = (raw.Status || "").trim();
  if (statusRaw) {
    const match = ref.statusByName.get(statusRaw.toLowerCase());
    if (!match) errors.push(`Unknown status "${statusRaw}".`);
    else statusId = match.id;
  }

  let sourceId = null;
  const sourceRaw = (raw.Source || "").trim();
  if (sourceRaw) {
    const match = ref.sourceByName.get(sourceRaw.toLowerCase());
    if (!match) errors.push(`Unknown source "${sourceRaw}".`);
    else sourceId = match.id;
  }

  let productId = null;
  const productRaw = (raw.Product || "").trim();
  if (productRaw) {
    const match = ref.productByName.get(productRaw.toLowerCase());
    if (!match) errors.push(`Unknown product "${productRaw}".`);
    else productId = match.id;
  }

  let assignedTo = null;
  const assignedRaw = (raw["Assigned Employee"] || "").trim();
  if (assignedRaw) {
    const match = ref.userByNameOrEmail.get(assignedRaw.toLowerCase());
    if (!match) errors.push(`"${assignedRaw}" does not belong to your Client, or is not an active Client Admin/Employee.`);
    else assignedTo = match.id;
  }

  // Only columns already classified as this Client's ACTIVE custom
  // fields ever reach validateLeadCustomFields — that function's own
  // "unknown custom field" branch can never fire from here, since
  // planColumns() already filtered to recognized fields.
  const customFieldInput = {};
  for (const col of ref.columnPlan) {
    if (col.kind !== "custom") continue;
    const cell = raw[col.header];
    if (cell === undefined || cell === null || cell === "") continue; // blank cell = not provided, not an empty-string value
    customFieldInput[col.def.field_key] = cell;
  }
  let customFields = {};
  if (Object.keys(customFieldInput).length) {
    try {
      customFields = validateLeadCustomFields(customFieldInput, ref.customFieldDefs);
    } catch (err) {
      errors.push(err.message);
    }
  }

  let duplicateReason = null;
  if (phone) {
    if (ref.existingPhones.has(phone)) {
      duplicateReason = "An existing lead in your Client already has this phone number.";
    } else if (ref.seenPhonesInFile.has(phone)) {
      duplicateReason = `Duplicate of row ${ref.seenPhonesInFile.get(phone)} earlier in this file.`;
    }
  }

  let status;
  if (errors.length) status = "invalid";
  else if (duplicateReason) status = "duplicate";
  else status = "ready";

  // Only a row that will actually be imported "claims" its phone number
  // for later-row duplicate detection — an invalid row's phone shouldn't
  // make a later, otherwise-valid row with the same number look like a
  // duplicate of something that was never actually going to be created.
  if (status === "ready" && phone) ref.seenPhonesInFile.set(phone, rowNumber);

  return {
    rowNumber,
    status,
    errors,
    duplicateReason,
    resolved: { name, phone, email, statusId, sourceId, productId, assignedTo, customFields },
  };
}

/**
 * The one shared classification pass — used identically by preview AND
 * confirm (Phase 3: confirm must re-validate, never trust preview's own
 * result), so there is exactly one place "is this row importable" is
 * decided. Reference data (statuses/sources/products/employees/custom
 * field defs) and the existing-phone set are each fetched ONCE per call
 * via small, Client-scoped queries — never once per row (Phase 19).
 */
async function classifyRows(clientId, rawRows) {
  const [statuses, sources, products, users, customFieldDefs] = await Promise.all([
    leadStatusModel.list(clientId),
    leadSourceModel.list(clientId),
    // includeInactive: true — matches assignLead/changeStatus's own
    // requireBelongsToClient checks, which don't filter by active state
    // either; a manually-created lead can target an inactive product too.
    productModel.list(clientId, { includeInactive: true }),
    userModel.listByClient(clientId),
    // includeInactive: false — matches customFieldService.validateForLead's
    // own active-only rule exactly.
    customFieldModel.list(clientId, { includeInactive: false }),
  ]);

  const statusByName = new Map(statuses.map((s) => [s.name.toLowerCase(), s]));
  const sourceByName = new Map(sources.map((s) => [s.name.toLowerCase(), s]));
  const productByName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
  const userByNameOrEmail = new Map();
  // active-only, client_admin/client_employee-only — matches assignLead's
  // own target-user validation exactly.
  users
    .filter((u) => u.status === "active" && ["client_admin", "client_employee"].includes(u.role_name))
    .forEach((u) => {
      userByNameOrEmail.set(u.name.toLowerCase(), u);
      userByNameOrEmail.set(u.email.toLowerCase(), u);
    });

  const headers = rawRows.length ? Object.keys(rawRows[0]) : [];
  const { columnPlan, fileWarnings } = planColumns(headers, customFieldDefs);

  const phonesInFile = [...new Set(rawRows.map((r) => normalizePhone(r.Phone)).filter(Boolean))];
  const existingPhones = new Set(phonesInFile.length ? await leadModel.findExistingPhones(clientId, phonesInFile) : []);

  const ref = { statusByName, sourceByName, productByName, userByNameOrEmail, columnPlan, customFieldDefs, existingPhones, seenPhonesInFile: new Map() };
  const rows = rawRows.map((raw, i) => classifyRow(raw, i + 2, ref)); // +1 for 0-index, +1 for the header row

  const summary = {
    totalRows: rows.length,
    readyCount: rows.filter((r) => r.status === "ready").length,
    duplicateCount: rows.filter((r) => r.status === "duplicate").length,
    invalidCount: rows.filter((r) => r.status === "invalid").length,
    fileWarnings,
  };

  return { rows, summary };
}

async function previewLeadImport(clientId, actor, file) {
  if (!file || !file.buffer) throw httpError("No file uploaded.", 400, "IMPORT_NO_FILE");
  if (file.buffer.length === 0) throw httpError("The uploaded file is empty.", 400, "IMPORT_EMPTY");

  const rawRows = parseCsvBuffer(file.buffer);
  const { rows, summary } = await classifyRows(clientId, rawRows);

  pruneExpiredImports();
  const token = crypto.randomUUID();
  pendingImports.set(token, { clientId, actorUserId: actor.userId, rawRows, filename: file.originalname, createdAt: Date.now() });

  return {
    token,
    filename: file.originalname,
    ...summary,
    rows: rows.slice(0, PREVIEW_DISPLAY_LIMIT),
    previewRowLimit: PREVIEW_DISPLAY_LIMIT,
  };
}

async function confirmLeadImport(clientId, actor, token) {
  if (!token || typeof token !== "string") throw httpError("token is required.", 400);

  pruneExpiredImports();
  const entry = pendingImports.get(token);
  // Ownership check: a token only unlocks the SAME Client + SAME actor's
  // own preview — never trust the token string alone, exactly the same
  // "never trust an id from the browser without an ownership check"
  // discipline every other bulk/export endpoint in this file already
  // applies to leadIds. A mismatch and "doesn't exist" are reported
  // identically (410, same message) so a token can't be used to probe
  // whether some OTHER client/actor has a pending import.
  if (!entry || entry.clientId !== clientId || entry.actorUserId !== actor.userId) {
    throw httpError("This import has expired or was already completed. Upload the file again.", 410, "IMPORT_TOKEN_INVALID");
  }
  // One-time use: deleted synchronously, before any awaited work — Node's
  // single-threaded execution means no other request can interleave
  // between this get() and delete(), so a genuinely concurrent double-
  // click's second request always finds nothing here, exactly like a DB
  // row's atomic UPDATE...WHERE claim (see integrationEventModel.
  // claimForProcessing for the same pattern one layer down).
  pendingImports.delete(token);

  // Re-classify from scratch against CURRENT data (Phase 3) — never reuse
  // whatever preview computed; a status could have been deleted, an
  // employee deactivated, or a duplicate created in the meantime.
  const { rows } = await classifyRows(clientId, entry.rawRows);
  const readyRows = rows.filter((r) => r.status === "ready");

  if (readyRows.length === 0) {
    throw httpError("No valid rows to import — every row is either a duplicate or has an error. Fix the file and upload again.", 400, "IMPORT_NOTHING_TO_IMPORT");
  }

  let imported = 0;
  let failed = 0;
  const failures = [];
  const partialFailures = [];

  for (const row of readyRows) {
    let lead;
    try {
      lead = await leadService.createLead(clientId, actor, {
        name: row.resolved.name,
        phone: row.resolved.phone,
        email: row.resolved.email,
        ...(row.resolved.sourceId ? { sourceId: row.resolved.sourceId } : {}), // omitted -> createLead's own "Manual" fallback applies, same as a manual lead with no source picked
        ...(row.resolved.productId ? { productId: row.resolved.productId } : {}),
        ...(Object.keys(row.resolved.customFields).length ? { customFields: row.resolved.customFields } : {}),
      });
    } catch (err) {
      failed++;
      failures.push({ rowNumber: row.rowNumber, error: err.message });
      continue;
    }
    imported++;

    // Status/assignment are each their OWN already-transactional call
    // (changeStatus/assignLead), separate from the createLead transaction
    // above — see this file's header comment for why. A failure here is
    // reported, not silently dropped: the lead was genuinely created
    // (counted in `imported`), but didn't get the status/assignment the
    // row asked for — extremely unlikely given both were just
    // re-validated moments earlier in this same request, but never
    // pretended not to happen if it does.
    if (row.resolved.statusId) {
      try {
        await leadService.changeStatus(clientId, actor, lead.id, { statusId: row.resolved.statusId });
      } catch (err) {
        partialFailures.push({ rowNumber: row.rowNumber, leadId: lead.id, error: `Lead created, but status could not be set: ${err.message}` });
      }
    }
    if (row.resolved.assignedTo) {
      try {
        await leadService.assignLead(clientId, actor, lead.id, { assignedTo: row.resolved.assignedTo });
      } catch (err) {
        partialFailures.push({ rowNumber: row.rowNumber, leadId: lead.id, error: `Lead created, but could not be assigned: ${err.message}` });
      }
    }
  }

  const result = {
    totalRows: rows.length,
    imported,
    skippedDuplicates: rows.filter((r) => r.status === "duplicate").length,
    skippedInvalid: rows.filter((r) => r.status === "invalid").length,
    failed,
    failures,
    partialFailures,
  };

  // Phase 20 — one row, not one per lead: lead-level history already
  // lives in lead_status_history/lead_activities (see createLead/
  // changeStatus/assignLead's own writes for each imported lead); this is
  // the platform-style audit_logs table instead, the same one Super
  // Admin/Agency-level actions already use, recording that an IMPORT
  // happened, not the leads it created. Counts only, never the file's
  // actual row content.
  try {
    await auditLogModel.create({
      tenantId: await clientModel.findTenantIdForClient(clientId),
      userId: actor.userId,
      action: "lead.csv_import",
      entityType: "client",
      entityId: clientId,
      meta: { filename: entry.filename, totalRows: result.totalRows, imported, skippedDuplicates: result.skippedDuplicates, skippedInvalid: result.skippedInvalid, failed },
    });
  } catch (err) {
    // Never let an audit-log write failure undo or mask a successful
    // import — the leads are already committed; just log loudly.
    logger.error(`Lead CSV import: audit log write failed for client_id=${clientId}: ${err.message}`);
  }

  return result;
}

module.exports = { previewLeadImport, confirmLeadImport, MAX_IMPORT_ROWS, MAX_IMPORT_COLUMNS, MAX_CELL_LENGTH };
