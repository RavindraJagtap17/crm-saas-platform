import { useEffect, useRef, useState } from "react";
import { clientsApi } from "../../api/resources";
import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { confirmDialog } from "../../components/confirmDialog";
import { toast, toastSuccess, toastError } from "../../components/toast";
import { EmptyState, SkeletonRows } from "../../components/States";
import { formatDate } from "../../utils/format";

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let checkoutScriptPromise = null;

// "Agency pays per Client" restructure — a one-off Order against the
// PLATFORM's own Razorpay account, never a connected Agency account.
function loadCheckoutScript() {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScriptPromise) {
    checkoutScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = RAZORPAY_CHECKOUT_SRC;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Razorpay Checkout. Check your connection and try again."));
      document.head.appendChild(script);
    });
  }
  return checkoutScriptPromise;
}

async function openCheckout({ razorpayKeyId, razorpayOrderId, amount, currency, clientName }, user, onSettled) {
  try {
    await loadCheckoutScript();
  } catch (err) {
    toastError(err.message);
    return;
  }
  const razorpay = new window.Razorpay({
    key: razorpayKeyId,
    order_id: razorpayOrderId,
    amount,
    currency,
    name: "Client License",
    description: clientName ? `Client License — ${clientName}` : "Client License",
    prefill: { name: user?.name || "", email: user?.email || "" },
    theme: { color: "#4f46e5" },
    // Browser-perceived success only — never trusted as payment proof;
    // only the webhook (razorpayWebhookService.js) ever activates a license.
    handler: () => onSettled("submitted"),
    modal: { ondismiss: () => onSettled("dismissed") },
  });
  razorpay.open();
}

/**
 * The effective client limit is ALWAYS the number GET /api/clients/limit
 * returns — never recomputed here from a plan's advertised features or
 * any other client-side guess. null = unlimited; 0 can only mean "no
 * active subscription" (a real plan's max_clients is either a positive
 * integer or null — see backend/src/validators/billingValidators.js).
 */
function formatLimitSummary(count, limit) {
  if (limit === 0) return { text: "0 available — no active subscription", over: false, blocked: true };
  if (limit === null) return { text: `${count} client${count === 1 ? "" : "s"} · Unlimited`, over: false, blocked: false };
  const over = count > limit;
  return {
    text: `${count} / ${limit} client${limit === 1 ? "" : "s"}${over ? " — Over plan limit" : ""}`,
    over,
    blocked: count >= limit,
  };
}

const LICENSE_STATUS_LABEL = { pending: "Awaiting payment", active: "Active", expired: "Expired" };
const LICENSE_STATUS_BADGE = { pending: "badge-warning", active: "badge-success", expired: "badge-danger" };

function LicenseBadge({ license }) {
  if (!license) return <span className="text-tertiary text-sm">—</span>;
  return <span className={`badge ${LICENSE_STATUS_BADGE[license.status] || "badge-neutral"}`}>{LICENSE_STATUS_LABEL[license.status] || license.status}</span>;
}

/**
 * §Client creation flow: Clients -> Add Client -> License payment -> Client
 * details -> Invite Client Admin -> Client created. Creating the client,
 * paying for its License, and inviting its first Client Admin are
 * separate steps — an "Invite later" skip is offered since the client
 * itself already exists as soon as the first step succeeds, and payment
 * confirmation is asynchronous (webhook-driven) regardless of when the
 * invite happens.
 */
function InviteAdminModal({ open, client, onDone }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open || !client) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await clientsApi.inviteAdmin(client.id, { name: name.trim(), email: email.trim(), role: "client_admin" });
      toastSuccess("Client Admin invited — they can now sign in with Google using that email.");
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`Invite the Client Admin for ${client.name}`}
      onClose={onDone}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onDone}>Skip for now</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>Send invite</LoadingButton>
        </>
      }
    >
      <p className="text-sm text-secondary mb-4">{client.name} was created. Invite its first Client Admin now, or skip and do this later.</p>
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="ia-name">Name</label>
          <input className="input" id="ia-name" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="ia-email">Email</label>
          <input className="input" type="email" id="ia-email" placeholder="jane@client-company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="hint">They'll sign in with this exact Google account.</span>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

function CreateClientModal({ open, user, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [mobile, setMobile] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const { client, checkout } = await clientsApi.create({
        name: name.trim(),
        address: address.trim(),
        city: city.trim(),
        gstNumber: gstNumber.trim().toUpperCase(),
        mobile: mobile.trim(),
        contactEmail: contactEmail.trim(),
      });
      toastSuccess("Client created.");
      if (checkout) {
        await openCheckout({ ...checkout, clientName: client.name }, user, (outcome) => {
          if (outcome === "submitted") toast("Payment submitted. Waiting for payment confirmation.");
          onCreated(client);
        });
      } else {
        toastError("Could not start the license payment — you can retry from the Clients list.");
        onCreated(client);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Add client"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>Create client</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="c-name">Client name</label>
          <input className="input" id="c-name" placeholder="Acme Retail Co." value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="c-address">Address</label>
          <input className="input" id="c-address" placeholder="221B Baker Street" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="c-city">City</label>
            <input className="input" id="c-city" placeholder="Mumbai" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="c-gst">GST number</label>
            <input className="input" id="c-gst" placeholder="27ABCDE1234F1Z5" style={{ textTransform: "uppercase" }} value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="c-mobile">Mobile</label>
            <input className="input" id="c-mobile" placeholder="+919876543210" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="c-contact-email">Contact email</label>
            <input className="input" type="email" id="c-contact-email" placeholder="contact@acme-retail.com" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </div>
        </div>
        <p className="hint">You&apos;ll pay for this Client&apos;s license right after creating it.</p>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default function Clients() {
  usePageTitle("Clients");
  const { user } = useAuth();
  const [clients, setClients] = useState(null);
  const [limit, setLimit] = useState(null);
  const [licenses, setLicenses] = useState({});
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteClient, setInviteClient] = useState(null);
  const renewingRef = useRef(new Set());
  const [, forceRender] = useState(0);

  const refresh = async () => {
    setClients(null);
    setError(null);
    try {
      const [{ clients: c }, { maxClients: l }] = await Promise.all([clientsApi.list(), clientsApi.limit()]);
      const licenseEntries = await Promise.all(
        c.map((client) => clientsApi.license(client.id).then(({ license }) => [client.id, license]).catch(() => [client.id, null]))
      );
      setClients(c);
      setLimit(l);
      setLicenses(Object.fromEntries(licenseEntries));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const deactivate = async (id) => {
    const ok = await confirmDialog({
      title: "Deactivate this client?",
      message: "Its Client Admin and employees will lose access to the CRM until you reactivate it.",
      confirmLabel: "Deactivate",
      danger: true,
    });
    if (!ok) return;
    try {
      await clientsApi.setStatus(id, "inactive");
      toastSuccess("Client deactivated.");
      await refresh();
    } catch (err) {
      toastError(err.message);
    }
  };

  const activate = async (id) => {
    try {
      await clientsApi.setStatus(id, "active");
      toastSuccess("Client activated.");
      await refresh();
    } catch (err) {
      toastError(err.message);
    }
  };

  const renew = async (client) => {
    renewingRef.current.add(client.id);
    forceRender((n) => n + 1);
    try {
      const { checkout } = await clientsApi.renewLicense(client.id);
      if (!checkout) {
        toastError("Could not start the license payment. Try again shortly.");
        return;
      }
      await openCheckout({ ...checkout, clientName: client.name }, user, (outcome) => {
        if (outcome === "submitted") toast("Payment submitted. Waiting for payment confirmation.");
        refresh();
      });
    } catch (err) {
      toastError(err.message);
    } finally {
      renewingRef.current.delete(client.id);
      forceRender((n) => n + 1);
    }
  };

  if (error && clients === null) {
    return (
      <>
        <div className="page-header">
          <div>
            <h2 className="page-title">Clients</h2>
            <p className="page-subtitle">The businesses your agency manages leads for.</p>
          </div>
        </div>
        <div className="card"><div className="card-body"><EmptyState icon="⚠" title="Couldn't load clients" desc={error} /></div></div>
      </>
    );
  }

  const summary = clients ? formatLimitSummary(clients.length, limit) : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Clients</h2>
          <p className="page-subtitle">The businesses your agency manages leads for.</p>
        </div>
        <button className="btn btn-primary" disabled={!!summary?.blocked} title={summary?.blocked ? "You've reached your plan's client limit." : ""} onClick={() => setCreateOpen(true)}>
          + Add Client
        </button>
      </div>

      <div className="card card-pad mb-4">
        {summary ? (
          <>
            <div className="stat-card" style={{ padding: 0 }}>
              <span className="stat-label">Clients</span>
              <span className="stat-value" style={{ fontSize: "1.25rem" }}>{summary.text}</span>
            </div>
            {summary.over ? (
              <div className="alert alert-warning mt-3">
                <span>⚠</span>
                <span>You&apos;re over your plan&apos;s client limit. Existing clients are kept — upgrade your plan or deactivate a client to add another.</span>
              </div>
            ) : null}
          </>
        ) : (
          <SkeletonRows count={1} />
        )}
      </div>

      <div className="card">
        {clients === null ? (
          <div className="card-body"><SkeletonRows count={2} /></div>
        ) : !clients.length ? (
          <div className="card-body"><EmptyState icon="◎" title="No clients yet" desc="Add your first client to start managing their leads." /></div>
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead><tr><th>Client</th><th>Status</th><th>License</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {clients.map((c) => {
                  const license = licenses[c.id];
                  const renewing = renewingRef.current.has(c.id);
                  return (
                    <tr key={c.id}>
                      <td data-label="Client" className="table-cell-primary">{c.name}</td>
                      <td data-label="Status">{c.status === "active" ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
                      <td data-label="License"><LicenseBadge license={license} /></td>
                      <td data-label="Created" className="text-secondary text-sm">{formatDate(c.createdAt)}</td>
                      <td data-label="" className="flex gap-2">
                        {license && (license.status === "pending" || license.status === "expired") ? (
                          <LoadingButton className="btn btn-secondary btn-sm" loading={renewing} onClick={() => renew(c)}>
                            {license.status === "pending" ? "Resume Payment" : "Renew"}
                          </LoadingButton>
                        ) : null}
                        {c.status === "active" ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => deactivate(c.id)}>Deactivate</button>
                        ) : (
                          <button className="btn btn-secondary btn-sm" onClick={() => activate(c.id)}>Activate</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateClientModal
        open={createOpen}
        user={user}
        onClose={() => setCreateOpen(false)}
        onCreated={(client) => { setCreateOpen(false); setInviteClient(client); }}
      />
      <InviteAdminModal open={!!inviteClient} client={inviteClient} onDone={async () => { setInviteClient(null); await refresh(); }} />
    </>
  );
}
