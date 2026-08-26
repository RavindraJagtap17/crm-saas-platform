import { escapeHtml } from "./ui.js";

/**
 * Renders the create/edit lead form body. Core fields are fixed; custom
 * fields are generated entirely from the tenant's active field
 * definitions (§F: "must dynamically render the tenant's custom fields
 * ... do not assume fixed custom fields"). Status/assignment are
 * deliberately NOT part of this form — they go through their own
 * dedicated actions on the lead detail page, matching how the API
 * enforces the same separation.
 */
export function buildLeadFormHtml({ sources, products, customFieldDefs, lead }) {
  const v = (key) => lead?.[key] ?? "";
  const cf = lead?.customFields || {};

  const customFieldsHtml = customFieldDefs
    .map((def) => {
      const value = cf[def.field_key] ?? "";
      const id = `cf-${def.field_key}`;
      let control;
      if (def.field_type === "select") {
        const options = Array.isArray(def.options) ? def.options : JSON.parse(def.options || "[]");
        control = `
          <select class="select" id="${id}" data-custom-field="${def.field_key}" data-field-type="select">
            <option value="">Select…</option>
            ${options.map((o) => `<option value="${escapeHtml(o)}" ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
          </select>`;
      } else if (def.field_type === "textarea") {
        control = `<textarea class="textarea" id="${id}" data-custom-field="${def.field_key}" data-field-type="textarea">${escapeHtml(value)}</textarea>`;
      } else if (def.field_type === "number") {
        control = `<input class="input" type="number" id="${id}" data-custom-field="${def.field_key}" data-field-type="number" value="${escapeHtml(value)}" />`;
      } else if (def.field_type === "date") {
        control = `<input class="input" type="date" id="${id}" data-custom-field="${def.field_key}" data-field-type="date" value="${escapeHtml(value)}" />`;
      } else {
        control = `<input class="input" type="text" id="${id}" data-custom-field="${def.field_key}" data-field-type="text" value="${escapeHtml(value)}" />`;
      }
      return `
        <div class="field" data-cf-field="${def.field_key}">
          <label class="label" for="${id}">${escapeHtml(def.label)}</label>
          ${control}
          <div class="field-error" hidden></div>
        </div>`;
    })
    .join("");

  return `
    <div class="field-row">
      <div class="field" data-field="name">
        <label class="label" for="lf-name">Name</label>
        <input class="input" id="lf-name" value="${escapeHtml(v("name"))}" placeholder="Jane Doe" />
        <div class="field-error" hidden></div>
      </div>
      <div class="field" data-field="phone">
        <label class="label" for="lf-phone">Phone</label>
        <input class="input" id="lf-phone" value="${escapeHtml(v("phone"))}" placeholder="+91 98765 43210" />
        <div class="field-error" hidden></div>
      </div>
    </div>
    <div class="field" data-field="email">
      <label class="label" for="lf-email">Email</label>
      <input class="input" type="email" id="lf-email" value="${escapeHtml(v("email"))}" placeholder="jane@example.com" />
      <div class="field-error" hidden></div>
    </div>
    <div class="field-row">
      <div class="field" data-field="sourceId">
        <label class="label" for="lf-source">Source <span class="optional">(optional — defaults to Manual)</span></label>
        <select class="select" id="lf-source">
          <option value="">Manual (default)</option>
          ${sources.map((s) => `<option value="${s.id}" ${String(s.id) === String(v("sourceId")) ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field" data-field="productId">
        <label class="label" for="lf-product">Product <span class="optional">(optional)</span></label>
        <select class="select" id="lf-product">
          <option value="">None</option>
          ${products.map((p) => `<option value="${p.id}" ${String(p.id) === String(v("productId")) ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </div>
    </div>
    ${customFieldsHtml ? `<div class="divider"></div><h3 class="text-sm font-semibold mb-2">Custom fields</h3>${customFieldsHtml}` : ""}
    <div class="field-error" data-form-error hidden style="margin-top:var(--space-2)"></div>
  `;
}

export function readLeadFormValues(scopeEl) {
  const customFields = {};
  scopeEl.querySelectorAll("[data-custom-field]").forEach((el) => {
    const key = el.dataset.customField;
    const type = el.dataset.fieldType;
    if (el.value === "") return; // omit empty optional custom fields entirely
    customFields[key] = type === "number" ? Number(el.value) : el.value;
  });

  return {
    name: scopeEl.querySelector("#lf-name").value.trim() || undefined,
    phone: scopeEl.querySelector("#lf-phone").value.trim() || undefined,
    email: scopeEl.querySelector("#lf-email").value.trim() || undefined,
    sourceId: scopeEl.querySelector("#lf-source").value || undefined,
    productId: scopeEl.querySelector("#lf-product").value || undefined,
    customFields,
  };
}

export function clearLeadFormErrors(scopeEl) {
  scopeEl.querySelectorAll(".field-error").forEach((el) => (el.hidden = true));
  scopeEl.querySelectorAll(".field.has-error").forEach((el) => el.classList.remove("has-error"));
}

/**
 * Best-effort mapping of a backend validation message onto the specific
 * field it's about, so the error appears next to the control instead of
 * only as a generic banner (§F: "custom field validation errors are
 * shown clearly").
 */
export function showLeadFormError(scopeEl, message) {
  const cfMatch = message.match(/custom field "([^"]+)"|Unknown custom field: (\S+)/i);
  const key = cfMatch?.[1] || cfMatch?.[2];
  if (key) {
    const field = scopeEl.querySelector(`[data-cf-field="${key}"]`);
    if (field) {
      field.classList.add("has-error");
      const err = field.querySelector(".field-error");
      err.hidden = false;
      err.textContent = message;
      return;
    }
  }
  const generic = scopeEl.querySelector("[data-form-error]");
  if (generic) {
    generic.hidden = false;
    generic.textContent = message;
  }
}
