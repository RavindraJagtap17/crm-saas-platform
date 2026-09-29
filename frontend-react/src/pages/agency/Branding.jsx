import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { tenantApi } from "../../api/resources";
import { resolveAssetUrl } from "../../api/client";
import { usePageTitle } from "../../layouts/PageTitleContext";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess, toastError } from "../../components/toast";

const DEFAULT_COLOR = "#4f46e5";
const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp";

function ImageUploadField({ label, hint, url, uploading, onSelect, onRemove }) {
  const inputRef = useRef(null);
  return (
    <div className="field">
      <label className="label">{label}</label>
      <div className="flex items-center gap-3">
        {url ? (
          <img src={resolveAssetUrl(url)} alt="" className="sidebar-logo" style={{ height: 40, width: 40, objectFit: "contain", background: "var(--surface-secondary)", borderRadius: 8 }} />
        ) : (
          <div style={{ height: 40, width: 40, borderRadius: 8, background: "var(--surface-secondary)" }} />
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onSelect(file);
          }}
        />
        <LoadingButton className="btn btn-secondary btn-sm" loading={uploading} onClick={() => inputRef.current?.click()}>
          {url ? "Replace" : "Upload"}
        </LoadingButton>
        {url ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={onRemove} disabled={uploading}>
            Remove
          </button>
        ) : null}
      </div>
      <span className="hint">{hint}</span>
    </div>
  );
}

export default function Branding() {
  usePageTitle("Branding");
  const { tenant: shellTenant } = useOutletContext() || {};
  const [name, setName] = useState(shellTenant?.name || "");
  const [logoUrl, setLogoUrl] = useState(shellTenant?.logoUrl || "");
  const [faviconUrl, setFaviconUrl] = useState(shellTenant?.faviconUrl || "");
  const [color, setColor] = useState(shellTenant?.brandPrimaryColor || DEFAULT_COLOR);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [faviconBusy, setFaviconBusy] = useState(false);

  const applyTenant = (tenant) => {
    setName(tenant?.name || "");
    setLogoUrl(tenant?.logoUrl || "");
    setFaviconUrl(tenant?.faviconUrl || "");
    setColor(tenant?.brandPrimaryColor || DEFAULT_COLOR);
  };

  useEffect(() => {
    if (shellTenant) return;
    (async () => {
      try {
        const { tenant } = await tenantApi.get();
        applyTenant(tenant);
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

  const selectLogo = async (file) => {
    setLogoBusy(true);
    try {
      const { tenant } = await tenantApi.uploadLogo(file);
      setLogoUrl(tenant.logoUrl || "");
      toastSuccess("Logo updated.");
      // Shell's own tenant state (sidebar logo, favicon link) is separate
      // from this page's local state and only resyncs on reload — same
      // reason save() below reloads after a name/color change.
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toastError(err.message || "Couldn't upload logo.");
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      const { tenant } = await tenantApi.deleteLogo();
      setLogoUrl(tenant.logoUrl || "");
      toastSuccess("Logo removed.");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toastError(err.message || "Couldn't remove logo.");
    } finally {
      setLogoBusy(false);
    }
  };

  const selectFavicon = async (file) => {
    setFaviconBusy(true);
    try {
      const { tenant } = await tenantApi.uploadFavicon(file);
      setFaviconUrl(tenant.faviconUrl || "");
      toastSuccess("Favicon updated.");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toastError(err.message || "Couldn't upload favicon.");
    } finally {
      setFaviconBusy(false);
    }
  };

  const removeFavicon = async () => {
    setFaviconBusy(true);
    try {
      const { tenant } = await tenantApi.deleteFavicon();
      setFaviconUrl(tenant.faviconUrl || "");
      toastSuccess("Favicon removed.");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toastError(err.message || "Couldn't remove favicon.");
    } finally {
      setFaviconBusy(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Branding</h2>
          <p className="page-subtitle">How your agency looks across every client workspace — name, logo, favicon, and brand color.</p>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-body">
          <form noValidate onSubmit={(e) => e.preventDefault()}>
            <div className="field">
              <label className="label" htmlFor="b-name">Agency name</label>
              <input className="input" id="b-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <ImageUploadField
              label="Logo"
              hint="PNG, JPEG, or WebP, up to 1MB. Shown in the sidebar across your agency and every client workspace."
              url={logoUrl}
              uploading={logoBusy}
              onSelect={selectLogo}
              onRemove={removeLogo}
            />

            <ImageUploadField
              label="Favicon"
              hint="PNG, JPEG, or WebP, up to 1MB. Shown as the browser tab icon."
              url={faviconUrl}
              uploading={faviconBusy}
              onSelect={selectFavicon}
              onRemove={removeFavicon}
            />

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
