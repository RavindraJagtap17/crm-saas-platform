import { useEffect, useState } from "react";
import { productsApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";

function ProductFormModal({ open, product, onClose, onSaved }) {
  const isEdit = !!product;
  const [name, setName] = useState(product?.name || "");
  const [description, setDescription] = useState(product?.description || "");
  const [isActive, setIsActive] = useState(product ? !!product.is_active : true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || undefined, isActive };
      if (isEdit) await productsApi.update(product.id, body);
      else await productsApi.create(body);
      toastSuccess(isEdit ? "Product updated." : "Product created.");
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
      title={isEdit ? "Edit product" : "New product"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>{isEdit ? "Save changes" : "Create product"}</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="p-name">Name</label>
          <input className="input" id="p-name" value={name} placeholder="e.g. Consulting" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="p-desc">
            Description <span className="optional">(optional)</span>
          </label>
          <textarea className="textarea" id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="checkbox-row">
          <input type="checkbox" id="p-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <label htmlFor="p-active" className="text-sm">Active (selectable on new leads)</label>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default function Products() {
  usePageTitle("Products");
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);
  const [modalProduct, setModalProduct] = useState(undefined);

  const refresh = async () => {
    setProducts(null);
    setError(null);
    try {
      setProducts((await productsApi.list(true)).products);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Products</h2>
          <p className="page-subtitle">Services leads can be tagged against.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalProduct(null)}>+ New Product</button>
      </div>

      <div className="card">
        {products === null ? (
          <div className="card-body">{error ? <EmptyState icon="⚠" title="Couldn't load products" desc={error} /> : <SkeletonRows count={1} />}</div>
        ) : !products.length ? (
          <div className="card-body"><EmptyState icon="▣" title="No products yet" desc="Add the services or products leads can be tagged against." /></div>
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Description</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Name" className="table-cell-primary">{p.name}</td>
                    <td data-label="Description" className="table-cell-muted">{p.description || "—"}</td>
                    <td data-label="Status">{p.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Disabled</span>}</td>
                    <td data-label=""><button className="btn btn-secondary btn-sm" onClick={() => setModalProduct(p)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProductFormModal open={modalProduct !== undefined} product={modalProduct} onClose={() => setModalProduct(undefined)} onSaved={async () => { setModalProduct(undefined); await refresh(); }} />
    </>
  );
}
