import { useEffect, useState } from "react";
import { superAdminApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import LoadingButton from "../../components/LoadingButton";
import { toastSuccess, toastError } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";

/**
 * New business model: the ONE price an Agency pays the Platform per
 * Client it adds, valid for exactly one year (client_license_price,
 * migration 055) — set via GET/PUT /api/super-admin/client-license-price.
 * Simpler than the old plan editor: no Razorpay Plan ID (Client licenses
 * are paid via one-off Orders against the platform's own Razorpay
 * account, not a recurring Subscription), no Active/Inactive toggle
 * (there's nothing to deactivate — this price always applies), no
 * billing cycle (fixed at one year by business rule).
 */
export default function ClientLicensePrice() {
  usePageTitle("Client License Price");
  const [price, setPrice] = useState(undefined);
  const [loadError, setLoadError] = useState(null);
  const [priceInput, setPriceInput] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setPrice(undefined);
    setLoadError(null);
    try {
      const { price: p } = await superAdminApi.getClientLicensePrice();
      setPrice(p);
      setPriceInput(p ? (p.price / 100).toFixed(2) : "");
      setCurrency(p?.currency || "INR");
    } catch (err) {
      setLoadError(err.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    setError(null);
    setSaving(true);
    const body = {
      price: Math.round(Number(priceInput) * 100), // smallest currency unit, matching every other price field in this app
      currency: currency.trim().toUpperCase(),
    };
    try {
      await superAdminApi.upsertClientLicensePrice(body);
      toastSuccess(price ? "Client license price updated." : "Client license price set up.");
      await refresh();
    } catch (err) {
      setError(err.message);
      toastError("Couldn't save the Client license price.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Client License Price</h2>
          <p className="page-subtitle">What every Agency pays per Client, per year.</p>
        </div>
      </div>

      {loadError ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-body"><EmptyState icon="⚠" title="Couldn't load the Client license price" desc={loadError} /></div>
        </div>
      ) : price === undefined ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-body"><SkeletonRows count={1} /></div>
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 560 }}>
          {!price ? (
            <div className="card-body">
              <EmptyState icon="$" title="No Client license price set up yet" desc="Set a price before any Agency can add a Client." />
            </div>
          ) : null}
          <div className="card-body">
            <form noValidate onSubmit={(e) => e.preventDefault()}>
              <div className="field-row">
                <div className="field">
                  <label className="label" htmlFor="clp-price">Price</label>
                  <input className="input" type="number" min="0" step="0.01" id="clp-price" value={priceInput} placeholder="4999.00" onChange={(e) => setPriceInput(e.target.value)} />
                  <span className="hint">Charged to the Agency each time they add a Client, and again each year at renewal.</span>
                </div>
                <div className="field">
                  <label className="label" htmlFor="clp-currency">Currency</label>
                  <input className="input" id="clp-currency" value={currency} maxLength={3} style={{ textTransform: "uppercase" }} onChange={(e) => setCurrency(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <span className="label">License term</span>
                <p className="text-sm text-secondary">One year — fixed by the business model, not configurable here.</p>
              </div>
              {error ? <div className="field-error">{error}</div> : null}
            </form>
          </div>
          <div className="card-footer">
            <LoadingButton className="btn btn-primary" loading={saving} onClick={save}>{price ? "Save changes" : "Set up price"}</LoadingButton>
          </div>
        </div>
      )}
    </>
  );
}
