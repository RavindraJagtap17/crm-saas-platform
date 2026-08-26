const webFormModel = require("../models/webFormModel");
const customFieldModel = require("../models/customFieldModel");
const leadService = require("../services/leadService");
const httpError = require("../utils/httpError");

// Shared literal between this file and the widget/iframe embed scripts —
// deliberately not exposed via the public config response (no reason to
// advertise the trap field's name), just kept in sync by convention and
// documented in docs/API.md.
const HONEYPOT_FIELD_NAME = "hp_company_website";

// Only what a third-party page needs to render the form — no tenant id,
// no internal source/product ids, nothing beyond field metadata.
async function getPublicConfig(form) {
  const customFields = await customFieldModel.list(form.tenant_id, { includeInactive: false });
  return {
    formName: form.name,
    fields: [
      { key: "name", label: "Name", type: "text", core: true },
      { key: "phone", label: "Phone", type: "text", core: true },
      { key: "email", label: "Email", type: "email", core: true },
      ...customFields.map((f) => ({
        key: f.field_key,
        label: f.label,
        type: f.field_type,
        core: false,
        options: f.field_type === "select" ? (Array.isArray(f.options) ? f.options : JSON.parse(f.options || "[]")) : undefined,
      })),
    ],
  };
}

/**
 * The entire point of Step 6: this is a thin adapter in front of
 * leadService.createLead (§H) — tenant scoping, phone normalization,
 * duplicate detection, custom-field validation, and the unassigned-by-
 * default rule all come from Step 4 unchanged. Nothing here re-implements
 * any of that.
 */
async function submitPublicLead(form, rawBody) {
  if (rawBody?.[HONEYPOT_FIELD_NAME]) {
    // Bots that auto-fill every field trip this. Never reveal detection —
    // the caller returns the same success shape as a real submission,
    // just without creating anything.
    return { honeypotTriggered: true };
  }

  const body = {
    name: typeof rawBody?.name === "string" ? rawBody.name : undefined,
    phone: typeof rawBody?.phone === "string" ? rawBody.phone : undefined,
    email: typeof rawBody?.email === "string" ? rawBody.email : undefined,
    customFields: rawBody?.customFields,
    // Always the form's own configuration — never read from rawBody, so a
    // public caller cannot claim a different source/product than the one
    // this formKey was actually set up with.
    sourceId: form.source_id,
    productId: form.product_id ?? undefined,
  };

  const actor = { userId: null, role: "public_form" };
  const lead = await leadService.createLead(form.tenant_id, actor, body);
  return { honeypotTriggered: false, lead };
}

async function resolveActiveForm(formKey) {
  const form = await webFormModel.findByKey(formKey);
  if (!form || !form.is_active) {
    throw httpError("This form is not available.", 404, "FORM_NOT_FOUND");
  }
  return form;
}

module.exports = { HONEYPOT_FIELD_NAME, getPublicConfig, submitPublicLead, resolveActiveForm };
