import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, homeForRole } from "../../auth/AuthContext";
import { authApi } from "../../api/resources";
import { API_BASE_URL } from "../../api/client";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
function isPlaceholder(id) {
  return !id || id.startsWith("PLACEHOLDER");
}

// Loose, client-side sanity checks only — mirrors the server's own
// validators just closely enough to give a same-field inline error instead
// of a generic alert; the server remains the actual authority.
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = [
  { key: "name", label: "Agency name" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "gstNumber", label: "GST number" },
  { key: "mobile", label: "Mobile" },
  { key: "contactEmail", label: "Contact email" },
];

/**
 * Ported from the old frontend's auth-signup.js. Google Identity Services'
 * rendered button fires its callback the moment an account is picked — it
 * cannot be gated on form fields the way a normal submit button can, so
 * every field is validated inside the callback itself using the LATEST
 * form values (a ref, not stale closure state) — any invalid field shows
 * an inline error and never calls the API; the user fixes it and clicks
 * the Google button again.
 */
export default function SignUp() {
  const { user, loading, setSession } = useAuth();
  const navigate = useNavigate();
  const gsiRef = useRef(null);
  const [alert, setAlert] = useState(null);
  const [fields, setFields] = useState({ name: "", address: "", city: "", gstNumber: "", mobile: "", contactEmail: "" });
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const [errors, setErrors] = useState({});
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate(homeForRole(user.role), { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (loading || user) return;

    function readAndValidate() {
      const values = { ...fieldsRef.current };
      const fieldErrors = {};
      if (!values.name.trim()) fieldErrors.name = "Agency name is required.";
      if (!values.address.trim()) fieldErrors.address = "Address is required.";
      if (!values.city.trim()) fieldErrors.city = "City is required.";
      if (!GSTIN_PATTERN.test(values.gstNumber.trim().toUpperCase())) fieldErrors.gstNumber = "Enter a valid 15-character GSTIN.";
      if (!PHONE_PATTERN.test(values.mobile.trim())) fieldErrors.mobile = "Enter a valid mobile number.";
      if (!EMAIL_PATTERN.test(values.contactEmail.trim())) fieldErrors.contactEmail = "Enter a valid email address.";
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length) return null;
      return {
        name: values.name.trim(),
        address: values.address.trim(),
        city: values.city.trim(),
        gstNumber: values.gstNumber.trim().toUpperCase(),
        mobile: values.mobile.trim(),
        contactEmail: values.contactEmail.trim(),
      };
    }

    async function handleCredentialResponse(response) {
      setAlert(null);
      const clean = readAndValidate();
      if (!clean) return;
      try {
        const { user: signedUpUser, accessToken } = await authApi.signup(response.credential, clean);
        setSession({ user: signedUpUser, accessToken });
        navigate(homeForRole(signedUpUser.role), { replace: true });
      } catch (err) {
        if (err.code === "ACCOUNT_EXISTS") {
          setAlert(
            <>
              {err.message} <a href="/auth">Sign in instead</a>
            </>
          );
        } else {
          setAlert(err.message || "Signup failed. Please try again.");
        }
      }
    }

    function initGoogleButton() {
      if (isPlaceholder(GOOGLE_CLIENT_ID) || !window.google?.accounts?.id || !gsiRef.current) return;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
      window.google.accounts.id.renderButton(gsiRef.current, { theme: "outline", size: "large", width: 320, text: "signup_with" });
    }

    if (window.google?.accounts?.id) initGoogleButton();
    else window.addEventListener("load", initGoogleButton);

    // No dev bypass for signup (always verifies a real Google ID token) —
    // just note it, pointing dev users at Sign In's dev panel instead.
    fetch(`${API_BASE_URL}/api/auth/dev-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
      .then((res) => setIsDev(res.status !== 404))
      .catch(() => setIsDev(false));

    return () => window.removeEventListener("load", initGoogleButton);
  }, [loading, user, navigate, setSession]);

  if (loading || user) return null;

  const setField = (key) => (e) => setFields((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-mark" aria-hidden="true">C</div>
          <h1 className="auth-title">Start your agency</h1>
          <p className="auth-subtitle">Tell us about your agency, then sign up with Google to become its Agency Admin</p>
        </div>

        <div className="card card-pad">
          {alert ? (
            <div className="alert alert-danger" role="alert">
              {alert}
            </div>
          ) : null}

          <div className="field">
            <label className="label" htmlFor="su-agency-name">Agency name</label>
            <input className="input" id="su-agency-name" placeholder="Acme Marketing Agency" value={fields.name} onChange={setField("name")} />
            {errors.name ? <div className="field-error">{errors.name}</div> : null}
          </div>
          <div className="field">
            <label className="label" htmlFor="su-address">Address</label>
            <input className="input" id="su-address" placeholder="221B Baker Street" value={fields.address} onChange={setField("address")} />
            {errors.address ? <div className="field-error">{errors.address}</div> : null}
          </div>
          <div className="field-row">
            <div className="field">
              <label className="label" htmlFor="su-city">City</label>
              <input className="input" id="su-city" placeholder="Mumbai" value={fields.city} onChange={setField("city")} />
              {errors.city ? <div className="field-error">{errors.city}</div> : null}
            </div>
            <div className="field">
              <label className="label" htmlFor="su-gst">GST number</label>
              <input className="input" id="su-gst" placeholder="27ABCDE1234F1Z5" style={{ textTransform: "uppercase" }} value={fields.gstNumber} onChange={setField("gstNumber")} />
              {errors.gstNumber ? <div className="field-error">{errors.gstNumber}</div> : null}
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label className="label" htmlFor="su-mobile">Mobile</label>
              <input className="input" id="su-mobile" placeholder="+919876543210" value={fields.mobile} onChange={setField("mobile")} />
              {errors.mobile ? <div className="field-error">{errors.mobile}</div> : null}
            </div>
            <div className="field">
              <label className="label" htmlFor="su-contact-email">Contact email</label>
              <input className="input" type="email" id="su-contact-email" placeholder="contact@acme-agency.com" value={fields.contactEmail} onChange={setField("contactEmail")} />
              {errors.contactEmail ? <div className="field-error">{errors.contactEmail}</div> : null}
            </div>
          </div>

          <div className="gsi-slot" ref={gsiRef} style={{ marginTop: "var(--space-4)" }} />
          {isPlaceholder(GOOGLE_CLIENT_ID) ? (
            <div className="hint" style={{ textAlign: "center", marginTop: "var(--space-3)" }}>
              Google Sign-In isn't configured for this environment yet (no <code>GOOGLE_CLIENT_ID</code> set).
            </div>
          ) : null}
          <p className="hint" style={{ textAlign: "center", marginTop: "var(--space-3)" }}>
            You'll set up payment for your agency's subscription right after this.
          </p>
        </div>

        {isDev ? (
          <div className="card card-pad mt-4" style={{ borderStyle: "dashed" }}>
            <p className="text-xs text-tertiary font-semibold mb-2">DEVELOPMENT — not available in production</p>
            <p className="text-sm text-secondary">Signup always requires a real Google account — there's no dev bypass for it. Use Sign In's dev panel to sign in as an already-seeded account instead.</p>
          </div>
        ) : null}

        <p className="auth-footer">Already have an account? <a href="/auth">Sign in</a></p>
      </div>
    </main>
  );
}
