import { Navigate, Outlet } from "react-router-dom";
import { useAuth, homeForRole } from "./AuthContext";

/**
 * Role-gated route guard — ported from the old frontend's requireRole()
 * (session.js) + shell.js's computeBlockedRedirect/redirectIfBlocked,
 * combined into one place since React Router handles the "don't render
 * anything until this resolves" behavior structurally (no flash of
 * unauthorized content) rather than needing every page to check for null.
 *
 * This is a UX convenience only — the backend remains the actual
 * authority on every API call regardless of what this decides.
 */
const BLOCKED_REDIRECT = {
  agency_admin: "/agency/account-inactive",
  client_admin: "/admin/account-inactive",
  client_employee: "/employee/account-inactive",
};

function computeBlockedRedirect(user) {
  if (user.role === "super_admin") return null;
  if (user.role === "agency_admin") {
    if (!user.tenantStatus || user.tenantStatus === "active") return null;
    return BLOCKED_REDIRECT.agency_admin;
  }
  if (user.role === "client_admin" || user.role === "client_employee") {
    const agencyBlocked = !!user.tenantStatus && user.tenantStatus !== "active";
    const clientBlocked = !!user.clientStatus && user.clientStatus !== "active";
    if (!agencyBlocked && !clientBlocked) return null;
    return BLOCKED_REDIRECT[user.role];
  }
  return null;
}

export default function ProtectedRoute({ roles, allowBlocked = false }) {
  const { user, loading } = useAuth();

  if (loading) return null; // same "no flash of unauthorized content" as the old app's own main()-never-renders-before-resolving pattern

  if (!user) return <Navigate to="/auth" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeForRole(user.role)} replace />;

  if (!allowBlocked) {
    const blockedPath = computeBlockedRedirect(user);
    if (blockedPath) return <Navigate to={blockedPath} replace />;
  }

  return <Outlet />;
}
