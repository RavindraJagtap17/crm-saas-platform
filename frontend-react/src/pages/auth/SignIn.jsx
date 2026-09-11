import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, homeForRole } from "../../auth/AuthContext";
import { authApi } from "../../api/resources";
import { API_BASE_URL } from "../../api/client";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const DEV_ROLES = [
  { role: "super_admin", label: "Super Admin" },
  { role: "agency_admin_test101", label: "Agency Admin — Test Agency 101" },
  { role: "client_admin_test101", label: "Client Admin — Test Client A1" },
  { role: "client_employee_test101", label: "Client Employee — Test Client A1" },
];

function isPlaceholder(id) {
  return !id || id.startsWith("PLACEHOLDER");
}

/**
 * Ported from the old frontend's auth-signin.js. Google Identity Services'
 * rendered button is imperative (renderButton mutates a DOM node directly),
 * so it's wired via a ref + effect rather than as JSX — the one place in
 * this migration where a third-party script's own API requires a real DOM
 * handle instead of a React pattern.
 */
export default function SignIn() {
  const { user, loading, setSession } = useAuth();
  const navigate = useNavigate();
  const gsiRef = useRef(null);
  const [alert, setAlert] = useState(null);
  const [devRoles, setDevRoles] = useState(null); // null = not checked yet, [] = not a dev backend
  const [devBusyRole, setDevBusyRole] = useState(null);

  useEffect(() => {
    if (!loading && user) navigate(homeForRole(user.role), { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (loading || user) return;

    async function handleCredentialResponse(response) {
      try {
        const { user: signedInUser, accessToken } = await authApi.google(response.credential);
        setSession({ user: signedInUser, accessToken });
        navigate(homeForRole(signedInUser.role), { replace: true });
      } catch (err) {
        setAlert(err.message || "Sign-in failed. Please try again.");
      }
    }

    function initGoogleButton() {
      if (isPlaceholder(GOOGLE_CLIENT_ID) || !window.google?.accounts?.id || !gsiRef.current) return;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
      window.google.accounts.id.renderButton(gsiRef.current, { theme: "outline", size: "large", width: 320, text: "signin_with" });
    }

    if (window.google?.accounts?.id) initGoogleButton();
    else window.addEventListener("load", initGoogleButton);

    // Development-only: probe whether the backend's dev-login route exists
    // (registered only when NODE_ENV !== "production").
    fetch(`${API_BASE_URL}/api/auth/dev-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
      .then((res) => setDevRoles(res.status !== 404 ? DEV_ROLES : []))
      .catch(() => setDevRoles([]));

    return () => window.removeEventListener("load", initGoogleButton);
  }, [loading, user, navigate, setSession]);

  const handleDevLogin = async (role) => {
    setDevBusyRole(role);
    try {
      const { user: signedInUser, accessToken } = await authApi.devLogin(role);
      setSession({ user: signedInUser, accessToken });
      navigate(homeForRole(signedInUser.role), { replace: true });
    } catch (err) {
      setAlert(err.message || "Dev sign-in failed. Have you run backend/scripts/seedDevAuth.js?");
      setDevBusyRole(null);
    }
  };

  if (loading || user) return null;

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-mark" aria-hidden="true">C</div>
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Sign in to your CRM workspace</p>
        </div>

        <div className="card card-pad">
          {alert ? (
            <div className="alert alert-danger" role="alert">
              {alert}
            </div>
          ) : null}
          <div className="gsi-slot" ref={gsiRef} />
          {isPlaceholder(GOOGLE_CLIENT_ID) ? (
            <div className="hint" style={{ textAlign: "center", marginTop: "var(--space-3)" }}>
              Google Sign-In isn't configured for this environment yet (no <code>GOOGLE_CLIENT_ID</code> set).
            </div>
          ) : null}
        </div>

        {devRoles && devRoles.length > 0 ? (
          <div className="card card-pad mt-4" style={{ borderStyle: "dashed" }}>
            <p className="text-xs text-tertiary font-semibold mb-3">DEVELOPMENT SIGN-IN — not available in production</p>
            <div className="flex-col gap-2">
              {devRoles.map((r) => (
                <button key={r.role} className="btn btn-secondary btn-sm w-full" disabled={devBusyRole === r.role} onClick={() => handleDevLogin(r.role)}>
                  Sign in as {r.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className="auth-footer">
          New agency? <a href="/auth/signup">Start your agency</a>
          <br />
          Client Admin or Employee? Ask your agency administrator to invite you.
        </p>
      </div>
    </main>
  );
}
