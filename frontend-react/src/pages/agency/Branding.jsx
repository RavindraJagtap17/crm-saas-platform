import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { tenantApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess, toastError } from "../../components/toast";

const DEFAULT_COLOR = "#4f46e5";

export default function Branding() {
  usePageTitle("Branding");
  const { tenant: shellTenant } = useOutletContext() || {};
  const [name, setName] = useState(shellTenant?.name || "");
  const [logoUrl, setLogoUrl] = useState(shellTenant?.logoUrl || "");
  const [color, setColor] = useState(shellTenant?.brandPrimaryColor || DEFAULT_COLOR);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (shellTenant) return;
    (async () => {
      try {
        const { tenant } = await tenantApi.get();
        setName(tenant?.name || "");
        setLogoUrl(tenant?.logoUrl || "");
        setColor(tenant?.brandPrimaryColor || DEFAULT_COLOR);
      } catch {
        // Branding form still renders with blank defaults — same as the old page's silent fallback.
      }
    })();
  }, [shellTenant]);

  const onColorChange = (value) => {
    setColor(value);
    document.documentElement.style.setProperty("--brand-500", value);
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await tenantApi.update({
        name: name.trim(),
        logoUrl: logoUrl.trim() || null,
        brandPrimaryColor: color,
      });
      toastSuccess("Branding updated.");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setError(err.message);
      toastError("Couldn't save branding.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Branding</h2>
          <p className="page-subtitle">How your agency looks across every client workspace — name, logo, and brand color.</p>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-body">
          <form noValidate onSubmit={(e) => e.preventDefault()}>
            <div className="field">
              <label className="label" htmlFor="b-name">Agency name</label>
              <input className="input" id="b-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="b-logo">Logo URL <span className="optional">(optional)</span></label>
              <input className="input" id="b-logo" value={logoUrl} placeholder="https://…/logo.png" onChange={(e) => setLogoUrl(e.target.value)} />
              <span className="hint">A hosted image URL — file upload isn&apos;t part of Phase 1.</span>
            </div>
            <div className="field">
              <label className="label" htmlFor="b-color">Brand color</label>
              <div className="flex items-center gap-3">
                <input className="input" type="color" id="b-color" value={color} onChange={(e) => onColorChange(e.target.value)} style={{ height: 40, width: 64, padding: 4 }} />
                <span className="text-sm text-secondary num">{color}</span>
              </div>
              <span className="hint">Used for buttons, links, and highlights throughout your agency&apos;s and every client&apos;s workspace.</span>
            </div>
            {error ? <div className="field-error">{error}</div> : null}
          </form>
        </div>
        <div className="card-footer">
          <LoadingButton className="btn btn-primary" loading={saving} onClick={save}>Save branding</LoadingButton>
        </div>
      </div>
    </>
  );
}
