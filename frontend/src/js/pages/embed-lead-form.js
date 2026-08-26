/**
 * Iframe fallback (§C) — same formKey, same public submission API, same
 * server-side validation/duplicate-detection/domain rules as the script
 * widget. This page never imports session.js/api/client.js — it's public
 * and unauthenticated by design, so it talks to the API with plain
 * fetch(), not the authenticated app's request layer.
 */
import { escapeHtml, setButtonLoading } from "../components/ui.js";

const API_BASE_URL = window.CRM_CONFIG?.API_BASE_URL || "http://localhost:4000";
const HONEYPOT_FIELD = "hp_company_website"; // must match backend's publicFormService.js

const formKey = new URLSearchParams(window.location.search).get("formKey");
const root = document.getElementById("embed-root");

function fieldControlHtml(field) {
  const id = `f-${field.key}`;
  if (field.type === "select") {
    const options = (field.options || []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
    return `<select class="select" id="${id}" name="${field.key}"><option value="">Select…</option>${options}</select>`;
  }
  if (field.type === "textarea") {
    return `<textarea class="textarea" id="${id}" name="${field.key}"></textarea>`;
  }
  const type = field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return `<input class="input" type="${type}" id="${id}" name="${field.key}" />`;
}

function render(config) {
  const fieldsHtml = config.fields
    .map(
      (f) => `<div class="field"><label class="label" for="f-${f.key}">${escapeHtml(f.label)}</label>${fieldControlHtml(f)}</div>`
    )
    .join("");

  root.innerHTML = `
    <h2 style="margin-bottom:var(--space-4)">${escapeHtml(config.formName)}</h2>
    <form id="enquiry-form" novalidate>
      ${fieldsHtml}
      <div class="hp-field" aria-hidden="true">
        <label for="hp">Company Website</label>
        <input id="hp" name="${HONEYPOT_FIELD}" type="text" tabindex="-1" autocomplete="off" />
      </div>
      <button class="btn btn-primary btn-block" type="submit">Submit</button>
      <div id="form-msg" class="mt-4"></div>
    </form>
  `;

  const formEl = document.getElementById("enquiry-form");
  const msgEl = document.getElementById("form-msg");
  const coreKeys = new Set(["name", "phone", "email"]);

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgEl.innerHTML = "";
    const submitBtn = formEl.querySelector("button[type=submit]");
    setButtonLoading(submitBtn, true);

    const payload = { customFields: {} };
    config.fields.forEach((field) => {
      const el = formEl.querySelector(`[name="${field.key}"]`);
      if (!el) return;
      if (coreKeys.has(field.key)) payload[field.key] = el.value;
      else if (el.value) payload.customFields[field.key] = field.type === "number" ? Number(el.value) : el.value;
    });
    payload[HONEYPOT_FIELD] = formEl.querySelector(`[name="${HONEYPOT_FIELD}"]`)?.value || "";

    try {
      const res = await fetch(`${API_BASE_URL}/api/public/lead-form/${encodeURIComponent(formKey)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Submission failed.");
      formEl.style.display = "none";
      msgEl.innerHTML = `<div class="alert alert-success">${escapeHtml(data?.message || "Thanks — we'll be in touch shortly.")}</div>`;
    } catch (err) {
      msgEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
      setButtonLoading(submitBtn, false);
    }
  });
}

async function main() {
  if (!formKey) {
    root.innerHTML = `<div class="alert alert-danger">No form specified.</div>`;
    return;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/public/lead-form/${encodeURIComponent(formKey)}`);
    if (!res.ok) throw new Error();
    render(await res.json());
  } catch {
    root.innerHTML = `<div class="alert alert-danger">This form is currently unavailable.</div>`;
  }
}

main();
