/**
 * Create/edit lead form fields — ported from the old frontend's
 * components/leadForm.js, now controlled React inputs instead of an HTML
 * string + querySelector-based readLeadFormValues(). Status/assignment are
 * deliberately NOT part of this form — they go through their own dedicated
 * actions on the lead detail page, matching how the API enforces the same
 * separation. `fieldErrors` maps a field key (or a custom field's
 * field_key) to a message, mirroring the old showLeadFormError()'s
 * per-field attribution.
 */
export function emptyLeadFormValue(lead) {
  return {
    name: lead?.name || "",
    phone: lead?.phone || "",
    email: lead?.email || "",
    sourceId: lead?.sourceId ? String(lead.sourceId) : "",
    productId: lead?.productId ? String(lead.productId) : "",
    customFields: { ...(lead?.customFields || {}) },
  };
}

// Converts the form's string-based state into the API body shape
// (omits empty optional fields, coerces number-type custom fields).
export function leadFormValueToBody(value, customFieldDefs) {
  const customFields = {};
  for (const def of customFieldDefs) {
    const raw = value.customFields[def.field_key];
    if (raw === undefined || raw === null || raw === "") continue;
    customFields[def.field_key] = def.field_type === "number" ? Number(raw) : raw;
  }
  return {
    name: value.name.trim() || undefined,
    phone: value.phone.trim() || undefined,
    email: value.email.trim() || undefined,
    sourceId: value.sourceId || undefined,
    productId: value.productId || undefined,
    customFields,
  };
}

// Maps a backend validation error message onto a specific field, mirroring
// the old showLeadFormError()'s best-effort regex match.
export function fieldErrorsFromMessage(message) {
  const cfMatch = message.match(/custom field "([^"]+)"|Unknown custom field: (\S+)/i);
  const key = cfMatch?.[1] || cfMatch?.[2];
  if (key) return { [key]: message };
  return { _form: message };
}

function CustomFieldControl({ def, value, onChange }) {
  const id = `cf-${def.field_key}`;
  if (def.field_type === "select") {
    const options = Array.isArray(def.options) ? def.options : JSON.parse(def.options || "[]");
    return (
      <select className="select" id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (def.field_type === "textarea") {
    return <textarea className="textarea" id={id} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (def.field_type === "number") {
    return <input className="input" type="number" id={id} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (def.field_type === "date") {
    return <input className="input" type="date" id={id} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input className="input" type="text" id={id} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export default function LeadForm({ sources, products, customFieldDefs, value, onChange, fieldErrors = {} }) {
  const set = (key) => (v) => onChange({ ...value, [key]: v });
  const setCustom = (key) => (v) => onChange({ ...value, customFields: { ...value.customFields, [key]: v } });

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()}>
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="lf-name">Name</label>
          <input className="input" id="lf-name" value={value.name} placeholder="Jane Doe" onChange={(e) => set("name")(e.target.value)} />
          {fieldErrors.name ? <div className="field-error">{fieldErrors.name}</div> : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="lf-phone">Phone</label>
          <input className="input" id="lf-phone" value={value.phone} placeholder="+91 98765 43210" onChange={(e) => set("phone")(e.target.value)} />
          {fieldErrors.phone ? <div className="field-error">{fieldErrors.phone}</div> : null}
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="lf-email">Email</label>
        <input className="input" type="email" id="lf-email" value={value.email} placeholder="jane@example.com" onChange={(e) => set("email")(e.target.value)} />
        {fieldErrors.email ? <div className="field-error">{fieldErrors.email}</div> : null}
      </div>
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="lf-source">
            Source <span className="optional">(optional — defaults to Manual)</span>
          </label>
          <select className="select" id="lf-source" value={value.sourceId} onChange={(e) => set("sourceId")(e.target.value)}>
            <option value="">Manual (default)</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="lf-product">
            Product <span className="optional">(optional)</span>
          </label>
          <select className="select" id="lf-product" value={value.productId} onChange={(e) => set("productId")(e.target.value)}>
            <option value="">None</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>
      {customFieldDefs.length ? (
        <>
          <div className="divider" />
          <h3 className="text-sm font-semibold mb-2">Custom fields</h3>
          {customFieldDefs.map((def) => (
            <div className="field" key={def.field_key}>
              <label className="label" htmlFor={`cf-${def.field_key}`}>{def.label}</label>
              <CustomFieldControl def={def} value={value.customFields[def.field_key] ?? ""} onChange={setCustom(def.field_key)} />
              {fieldErrors[def.field_key] ? <div className="field-error">{fieldErrors[def.field_key]}</div> : null}
            </div>
          ))}
        </>
      ) : null}
      {fieldErrors._form ? <div className="field-error" style={{ marginTop: "var(--space-2)" }}>{fieldErrors._form}</div> : null}
    </form>
  );
}
