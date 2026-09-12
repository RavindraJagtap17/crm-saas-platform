import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { webFormsApi, clientsApi } from "../../api/resources";
import { API_BASE_URL } from "../../api/client";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";

const FRONTEND_ORIGIN = window.location.origin;

function embedSnippets(form) {
  const scriptTag = `<script src="${FRONTEND_ORIGIN}/public/embed/crm-lead-widget.js" data-form-key="${form.formKey}" data-api-base="${API_BASE_URL}"></script>`;
  const iframeTag = `<iframe src="${FRONTEND_ORIGIN}/public/embed/lead-form.html?formKey=${form.formKey}&apiBase=${encodeURIComponent(API_BASE_URL)}" width="100%" height="520" style="border:0"></iframe>`;
  return { scriptTag, iframeTag };
}

async function loadClientCustomFields(clientId) {
  if (!clientId) return [];
  try {
    const { customFields } = await webFormsApi.clientCustomFields(clientId);
    return customFields;
  } catch {
    return [];
  }
}

function CustomFieldsPreview({ clientId, fields }) {
  return (
    <div className="field">
      <span className="label">This client&apos;s active custom fields</span>
      <p className="hint mb-2">
        Included automatically on this form — not individually selectable. <Link to={`/agency/custom-fields?clientId=${clientId}`}>Manage this client&apos;s custom fields →</Link>
      </p>
      {fields.length ? (
        <div>
          {fields.map((f) => (
            <span key={f.id} className="badge badge-neutral mr-1 mb-1">{f.label}</span>
          ))}
        </div>
      ) : (
        <p className="text-tertiary text-sm">This client has no custom fields configured yet.</p>
      )}
    </div>
  );
}

// Only name/allowed-domains/active/source/product are editable — clientId
// itself is deliberately not re-pointable after creation (matches the
// backend's own webFormService.update, which never accepts clientId).
function EditFormModal({ open, form, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [sources, setSources] = useState(null);
  const [products, setProducts] = useState(null);
  const [sourceId, setSourceId] = useState("");
  const [productId, setProductId] = useState("");
  const [domains, setDomains] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !form) return;
    setName(form.name);
    setDomains(form.allowedDomains.join("\n"));
    setIsActive(form.isActive);
    setSources(null);
    setProducts(null);
    (async () => {
      const [{ sources: s }, { products: p }] = await Promise.all([
        clientsApi.leadSources(form.clientId),
        clientsApi.products(form.clientId),
      ]);
      setSources(s);
      setProducts(p);
      setSourceId(String(form.sourceId));
      setProductId(form.productId ? String(form.productId) : "");
    })();
  }, [open, form]);

  if (!open || !form) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    const allowedDomains = domains.split(/\r?\n|,/).map((d) => d.trim()).filter(Boolean);
    try {
      await webFormsApi.update(form.id, {
        name: name.trim(),
        sourceId: Number(sourceId),
        productId: productId ? Number(productId) : null,
        allowedDomains,
        isActive,
      });
      toastSuccess("Form updated.");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Edit website form"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit} disabled={sources === null}>Save changes</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="wf-name">Name</label>
          <input className="input" id="wf-name" value={name} placeholder="e.g. Homepage Contact Form" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="wf-source">Source</label>
            <select className="select" id="wf-source" value={sourceId} disabled={sources === null} onChange={(e) => setSourceId(e.target.value)}>
              {sources === null ? (
                <option>Loading…</option>
              ) : (
                sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
              )}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="wf-product">Product <span className="optional">(optional)</span></label>
            <select className="select" id="wf-product" value={productId} disabled={products === null} onChange={(e) => setProductId(e.target.value)}>
              {products === null ? (
                <option>Loading…</option>
              ) : (
                <>
                  <option value="">None</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </>
              )}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="wf-domains">Allowed domains <span className="optional">(one per line)</span></label>
          <textarea className="textarea" id="wf-domains" placeholder={"example.com\nwww.example.com"} value={domains} onChange={(e) => setDomains(e.target.value)} />
          <span className="hint">Bare hostnames only — no https:// or path. Required for the script embed; the iframe embed doesn&apos;t need this.</span>
        </div>
        <div className="checkbox-row">
          <input type="checkbox" id="wf-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <label htmlFor="wf-active" className="text-sm">Active</label>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

function CreateFormModal({ open, clients, onClose, onCreated }) {
  const [selectedClientId, setSelectedClientId] = useState("");
  const [sources, setSources] = useState(null);
  const [products, setProducts] = useState(null);
  const [customFields, setCustomFields] = useState([]);
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [productId, setProductId] = useState("");
  const [domains, setDomains] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedClientId("");
      setSources(null);
      setProducts(null);
      setName("");
      setDomains("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const onClientChange = async (clientId) => {
    setSelectedClientId(clientId);
    setSources(null);
    setProducts(null);
    setName("");
    setDomains("");
    if (!clientId) return;
    const [{ sources: s }, { products: p }, cf] = await Promise.all([
      clientsApi.leadSources(clientId),
      clientsApi.products(clientId),
      loadClientCustomFields(clientId),
    ]);
    setSources(s);
    setProducts(p);
    setCustomFields(cf);
    setSourceId(s.length ? String(s[0].id) : "");
    setProductId("");
  };

  const submit = async () => {
    setError(null);
    if (!selectedClientId) return;
    setSaving(true);
    const allowedDomains = domains.split(/\r?\n|,/).map((d) => d.trim()).filter(Boolean);
    try {
      await webFormsApi.create({
        name: name.trim(),
        clientId: Number(selectedClientId),
        sourceId: Number(sourceId),
        productId: productId ? Number(productId) : undefined,
        allowedDomains,
      });
      toastSuccess("Form created.");
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = !!selectedClientId && sources !== null && sources.length > 0;

  return (
    <Modal
      open={open}
      title="New website form"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit} disabled={!canSubmit}>Create form</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="wf-client">Client</label>
          <select className="select" id="wf-client" value={selectedClientId} onChange={(e) => onClientChange(e.target.value)}>
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {selectedClientId ? (
          sources === null ? (
            <div className="skeleton skeleton-row" style={{ width: "70%" }} />
          ) : !sources.length ? (
            <EmptyState icon="⌘" title="This client has no lead sources yet" desc="A website form needs a source to tag its leads with — ask this client's Client Admin to create one first." />
          ) : (
            <>
              <div className="field">
                <label className="label" htmlFor="wf-name">Name</label>
                <input className="input" id="wf-name" placeholder="e.g. Homepage Contact Form" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="label" htmlFor="wf-source">Source</label>
                  <select className="select" id="wf-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                    {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="wf-product">Product <span className="optional">(optional)</span></label>
                  <select className="select" id="wf-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                    <option value="">None</option>
                    {(products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="wf-domains">Allowed domains <span className="optional">(one per line)</span></label>
                <textarea className="textarea" id="wf-domains" placeholder={"example.com\nwww.example.com"} value={domains} onChange={(e) => setDomains(e.target.value)} />
                <span className="hint">Bare hostnames only — no https:// or path. Required for the script embed; the iframe embed doesn&apos;t need this.</span>
              </div>
              <CustomFieldsPreview clientId={selectedClientId} fields={customFields} />
            </>
          )
        ) : null}
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

function FormCard({ form, clientName, onEdit }) {
  const { scriptTag, iframeTag } = embedSnippets(form);
  return (
    <div className="card mb-4">
      <div className="card-header">
        <div>
          <h3 className="card-title">{form.name}</h3>
          <p className="card-subtitle">Client: {clientName}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`badge ${form.isActive ? "badge-success" : "badge-neutral"}`}>{form.isActive ? "Active" : "Inactive"}</span>
          <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
        </div>
      </div>
      <div className="card-body flex-col gap-4">
        <div>
          <span className="label">Allowed domains</span>
          <div className="mt-2">
            {form.allowedDomains.length ? (
              form.allowedDomains.map((d) => <span key={d} className="badge badge-neutral mr-1">{d}</span>)
            ) : (
              <span className="text-tertiary text-sm">None yet — script embed will be rejected until you add one. Iframe embed works without it.</span>
            )}
          </div>
        </div>
        <div>
          <span className="label">Script embed</span>
          <pre className="code mt-2" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{scriptTag}</pre>
        </div>
        <div>
          <span className="label">Iframe embed</span>
          <pre className="code mt-2" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{iframeTag}</pre>
        </div>
      </div>
    </div>
  );
}

export default function WebForms() {
  usePageTitle("Website Forms");
  const [clients, setClients] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [forms, setForms] = useState(null);
  const [formsError, setFormsError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const refreshForms = async () => {
    setForms(null);
    setFormsError(null);
    try {
      const { forms: f } = await webFormsApi.list();
      setForms(f);
    } catch (err) {
      setFormsError(err.message);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const { clients: c } = await clientsApi.list();
        setClients(c);
        if (c.length) await refreshForms();
      } catch (err) {
        setLoadError(err.message);
      }
    })();
  }, []);

  const clientName = (clientId) => clients?.find((c) => c.id === clientId)?.name || `Client #${clientId}`;

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <div>
            <h2 className="page-title">Website Forms</h2>
            <p className="page-subtitle">Embed a lead form on one of your clients' websites — submissions land in that client's CRM automatically.</p>
          </div>
        </div>
        <EmptyState title="Couldn't load your clients" desc={loadError} />
      </>
    );
  }

  if (clients !== null && !clients.length) {
    return (
      <>
        <div className="page-header">
          <div>
            <h2 className="page-title">Website Forms</h2>
            <p className="page-subtitle">Embed a lead form on one of your clients' websites — submissions land in that client's CRM automatically.</p>
          </div>
          <button className="btn btn-primary" disabled>+ New Form</button>
        </div>
        <EmptyState icon="◎" title="Add a client first" desc="A website form needs to target one of your clients." action={<Link className="btn btn-secondary" to="/agency/clients">Go to Clients</Link>} />
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Website Forms</h2>
          <p className="page-subtitle">Embed a lead form on one of your clients' websites — submissions land in that client's CRM automatically.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ New Form</button>
      </div>

      {formsError ? (
        <EmptyState icon="⚠" title="Couldn't load website forms" desc={formsError} />
      ) : forms === null ? (
        <SkeletonRows count={2} />
      ) : !forms.length ? (
        <EmptyState icon="⌗" title="No website forms yet" desc="Create one to get an embeddable script tag and iframe code for a client's website." />
      ) : (
        forms.map((form) => (
          <FormCard key={form.id} form={form} clientName={clientName(form.clientId)} onEdit={() => setEditForm(form)} />
        ))
      )}

      <CreateFormModal open={createOpen} clients={clients || []} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await refreshForms(); }} />
      <EditFormModal open={!!editForm} form={editForm} onClose={() => setEditForm(null)} onSaved={async () => { setEditForm(null); await refreshForms(); }} />
    </>
  );
}
