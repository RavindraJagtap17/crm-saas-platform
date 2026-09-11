/**
 * CRM universal website enquiry form — iframe embed fallback.
 *
 * Usage on a third-party site:
 *   <iframe src="CRM_EMBED_URL/embed/lead-form.html?formKey=FORM_KEY"></iframe>
 *
 * Deliberately a single, dependency-free, non-module plain script (not
 * bundled by Vite, no ES imports) — same reasoning as crm-lead-widget.js
 * (the primary script embed): this page is fetched directly by the
 * browser when a third-party site iframes it, so it can't rely on
 * anything from the React SPA's own module graph. escapeHtml/
 * setButtonLoading below are ported verbatim from the old frontend's
 * components/ui.js rather than imported, for the same reason.
 *
 * Same formKey, same public submission API, same server-side validation/
 * duplicate-detection/domain rules as the script widget (crm-lead-widget.js).
 * Never imports the authenticated app's session/API layer — this talks to
 * the public API with plain fetch(), by design.
 */
(function () {
  "use strict";

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle("is-loading", loading);
    btn.disabled = loading;
    if (loading && !btn.querySelector(".spinner")) {
      btn.insertAdjacentHTML("beforeend", '<span class="spinner" aria-hidden="true"></span>');
    }
  }

  var params = new URLSearchParams(window.location.search);
  var formKey = params.get("formKey");

  // ?apiBase= is this page's equivalent of crm-lead-widget.js's own
  // data-api-base script attribute — an iframe has no attribute of its
  // own to read, so the parent page's embed snippet (WebForms.jsx)
  // passes it as a query param on the iframe src instead. Same default
  // as the widget: fall back to the origin this page was itself loaded
  // from when not provided.
  var API_BASE = params.get("apiBase") || window.location.origin;

  var HONEYPOT_FIELD = "hp_company_website"; // must match backend's publicFormService.js
  var root = document.getElementById("embed-root");

  function fieldControlHtml(field) {
    var id = "f-" + field.key;
    if (field.type === "select") {
      var options = (field.options || [])
        .map(function (o) {
          return '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + "</option>";
        })
        .join("");
      return '<select class="select" id="' + id + '" name="' + field.key + '"><option value="">Select…</option>' + options + "</select>";
    }
    if (field.type === "textarea") {
      return '<textarea class="textarea" id="' + id + '" name="' + field.key + '"></textarea>';
    }
    var type = field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
    return '<input class="input" type="' + type + '" id="' + id + '" name="' + field.key + '" />';
  }

  function render(config) {
    var fieldsHtml = config.fields
      .map(function (f) {
        return '<div class="field"><label class="label" for="f-' + f.key + '">' + escapeHtml(f.label) + "</label>" + fieldControlHtml(f) + "</div>";
      })
      .join("");

    // #form-msg is a SIBLING of the <form>, not nested inside it — the
    // success/error handler below hides the whole form on success
    // (formEl.style.display = "none"), which would otherwise hide this
    // message too, since a hidden ancestor hides its descendants.
    root.innerHTML =
      '<h2 style="margin-bottom:var(--space-4)">' +
      escapeHtml(config.formName) +
      '</h2><form id="enquiry-form" novalidate>' +
      fieldsHtml +
      '<div class="hp-field" aria-hidden="true"><label for="hp">Company Website</label>' +
      '<input id="hp" name="' +
      HONEYPOT_FIELD +
      '" type="text" tabindex="-1" autocomplete="off" /></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Submit</button>' +
      '</form><div id="form-msg" class="mt-4"></div>';

    var formEl = document.getElementById("enquiry-form");
    var msgEl = document.getElementById("form-msg");
    var coreKeys = { name: true, phone: true, email: true };

    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      msgEl.innerHTML = "";
      var submitBtn = formEl.querySelector('button[type="submit"]');
      setButtonLoading(submitBtn, true);

      var payload = { customFields: {} };
      config.fields.forEach(function (field) {
        var el = formEl.querySelector('[name="' + field.key + '"]');
        if (!el) return;
        if (coreKeys[field.key]) payload[field.key] = el.value;
        else if (el.value) payload.customFields[field.key] = field.type === "number" ? Number(el.value) : el.value;
      });
      var hpEl = formEl.querySelector('[name="' + HONEYPOT_FIELD + '"]');
      payload[HONEYPOT_FIELD] = hpEl ? hpEl.value : "";

      fetch(API_BASE + "/api/public/lead-form/" + encodeURIComponent(formKey) + "/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return null;
            })
            .then(function (data) {
              if (!res.ok) throw new Error((data && data.error) || "Submission failed.");
              formEl.style.display = "none";
              msgEl.innerHTML = '<div class="alert alert-success">' + escapeHtml((data && data.message) || "Thanks — we'll be in touch shortly.") + "</div>";
            });
        })
        .catch(function (err) {
          msgEl.innerHTML = '<div class="alert alert-danger">' + escapeHtml(err.message) + "</div>";
          setButtonLoading(submitBtn, false);
        });
    });
  }

  function main() {
    if (!formKey) {
      root.innerHTML = '<div class="alert alert-danger">No form specified.</div>';
      return;
    }
    fetch(API_BASE + "/api/public/lead-form/" + encodeURIComponent(formKey))
      .then(function (res) {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(render)
      .catch(function () {
        root.innerHTML = '<div class="alert alert-danger">This form is currently unavailable.</div>';
      });
  }

  main();
})();
