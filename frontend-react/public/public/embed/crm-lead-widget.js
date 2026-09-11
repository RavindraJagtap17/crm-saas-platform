/**
 * CRM universal website enquiry form — script embed (primary).
 *
 * Usage on a third-party site:
 *   <script src="CRM_EMBED_URL/embed/crm-lead-widget.js" data-form-key="FORM_KEY"></script>
 *
 * Deliberately a single, dependency-free, non-module file (an IIFE) so it
 * works when dropped into any host page via a plain <script> tag — no
 * build step, no framework, nothing for the host site to write. Renders
 * into a Shadow DOM so the host site's CSS can never reach in and this
 * widget's CSS can never leak out (§B).
 */
(function () {
  "use strict";

  var CURRENT_SCRIPT = document.currentScript;
  var FORM_KEY = CURRENT_SCRIPT.getAttribute("data-form-key");
  var API_BASE = CURRENT_SCRIPT.getAttribute("data-api-base");
  if (!API_BASE) {
    // Default: same origin the widget script itself was loaded from.
    var scriptUrl = new URL(CURRENT_SCRIPT.src, window.location.href);
    API_BASE = scriptUrl.origin;
  }

  // Must match backend/src/services/publicFormService.js's
  // HONEYPOT_FIELD_NAME exactly — kept as a literal in both places by
  // convention rather than fetched, so a public API response never
  // advertises the trap field's name.
  var HONEYPOT_FIELD = "hp_company_website";

  if (!FORM_KEY) {
    console.error("[CRM widget] Missing required data-form-key attribute.");
    return;
  }

  var host = document.createElement("div");
  host.style.all = "initial"; // stop the host page's inherited styles leaking into the shadow host itself
  host.style.display = "block";
  CURRENT_SCRIPT.parentNode.insertBefore(host, CURRENT_SCRIPT.nextSibling);
  var root = host.attachShadow({ mode: "open" });

  var STYLE = "" +
    ":host{all:initial}" +
    "*{box-sizing:border-box}" +
    ".crm-form{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;width:100%;color:#20232b}" +
    ".crm-field{margin-bottom:14px}" +
    ".crm-label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#3a3f4e}" +
    ".crm-input,.crm-select,.crm-textarea{width:100%;padding:10px 12px;font-size:14px;border:1px solid #cfd3dc;border-radius:8px;font-family:inherit;color:#20232b;background:#fff}" +
    ".crm-textarea{min-height:80px;resize:vertical}" +
    ".crm-input:focus,.crm-select:focus,.crm-textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.15)}" +
    ".crm-hp{position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden}" +
    ".crm-submit{display:inline-flex;align-items:center;justify-content:center;width:100%;padding:11px 16px;font-size:14px;font-weight:600;color:#fff;background:#4f46e5;border:none;border-radius:8px;cursor:pointer;font-family:inherit}" +
    ".crm-submit:hover{background:#4338ca}" +
    ".crm-submit:disabled{opacity:.6;cursor:not-allowed}" +
    ".crm-msg{font-size:13px;margin-top:10px;padding:10px 12px;border-radius:8px}" +
    ".crm-msg.crm-success{background:#e9f8ee;color:#16a34a}" +
    ".crm-msg.crm-error{background:#fdecec;color:#dc2626}" +
    ".crm-loading{font-size:13px;color:#6b7280}" +
    "@media (max-width:420px){.crm-form{max-width:100%}}";

  var styleEl = document.createElement("style");
  styleEl.textContent = STYLE;
  root.appendChild(styleEl);

  var container = document.createElement("div");
  container.className = "crm-form";
  container.innerHTML = '<p class="crm-loading">Loading form…</p>';
  root.appendChild(container);

  fetch(API_BASE + "/api/public/lead-form/" + encodeURIComponent(FORM_KEY))
    .then(function (res) {
      if (!res.ok) throw new Error("unavailable");
      return res.json();
    })
    .then(renderForm)
    .catch(function () {
      container.innerHTML = '<p class="crm-msg crm-error">This form is currently unavailable.</p>';
    });

  function fieldControl(field) {
    var id = "crm-f-" + field.key;
    if (field.type === "select") {
      var opts = (field.options || [])
        .map(function (o) {
          return '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + "</option>";
        })
        .join("");
      return '<select class="crm-select" id="' + id + '" name="' + field.key + '"><option value="">Select…</option>' + opts + "</select>";
    }
    if (field.type === "textarea") {
      return '<textarea class="crm-textarea" id="' + id + '" name="' + field.key + '"></textarea>';
    }
    var inputType = field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
    return '<input class="crm-input" type="' + inputType + '" id="' + id + '" name="' + field.key + '" />';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderForm(config) {
    var fieldsHtml = (config.fields || [])
      .map(function (field) {
        return (
          '<div class="crm-field"><label class="crm-label" for="crm-f-' +
          field.key +
          '">' +
          escapeHtml(field.label) +
          "</label>" +
          fieldControl(field) +
          "</div>"
        );
      })
      .join("");

    container.innerHTML =
      "<form novalidate>" +
      fieldsHtml +
      // Honeypot: visually and structurally present (so simple bots that
      // fill every field still trip it) but placed off-screen, not
      // display:none — some bots skip display:none fields specifically.
      '<div class="crm-hp" aria-hidden="true"><label for="crm-hp-field">Company Website</label>' +
      '<input id="crm-hp-field" name="' +
      HONEYPOT_FIELD +
      '" type="text" tabindex="-1" autocomplete="off" /></div>' +
      '<button type="submit" class="crm-submit">Submit</button>' +
      '<div class="crm-msg-slot"></div>' +
      "</form>";

    var formEl = container.querySelector("form");
    var msgSlot = container.querySelector(".crm-msg-slot");
    var submitBtn = container.querySelector(".crm-submit");
    var coreKeys = { name: 1, phone: 1, email: 1 };

    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      msgSlot.innerHTML = "";
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";

      var payload = { customFields: {} };
      (config.fields || []).forEach(function (field) {
        var el = formEl.querySelector('[name="' + field.key + '"]');
        if (!el) return;
        var value = el.value;
        if (coreKeys[field.key]) payload[field.key] = value;
        else if (value) payload.customFields[field.key] = field.type === "number" ? Number(value) : value;
      });
      var hpEl = formEl.querySelector('[name="' + HONEYPOT_FIELD + '"]');
      payload[HONEYPOT_FIELD] = hpEl ? hpEl.value : "";

      fetch(API_BASE + "/api/public/lead-form/" + encodeURIComponent(FORM_KEY) + "/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) throw new Error(result.data && result.data.error ? result.data.error : "Submission failed.");
          formEl.reset();
          formEl.style.display = "none";
          msgSlot.innerHTML = '<p class="crm-msg crm-success">' + escapeHtml((result.data && result.data.message) || "Thanks — we’ll be in touch shortly.") + "</p>";
        })
        .catch(function (err) {
          msgSlot.innerHTML = '<p class="crm-msg crm-error">' + escapeHtml(err.message || "Something went wrong. Please try again.") + "</p>";
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit";
        });
    });
  }
})();
