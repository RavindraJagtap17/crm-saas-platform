import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../api/client";
import { authApi } from "../api/resources";
import { getAccessToken, setAccessToken, clearAccessToken } from "./tokenStore";

/**
 * Session state for the whole app. Ported from the old frontend's
 * session.js, adapted to a React SPA: bootstrapSession() used to run on
 * EVERY page load (full reload each navigation, httpOnly refresh cookie
 * did the work); here it runs ONCE when the app mounts, and React Router
 * navigation never reloads the page — the refresh cookie still makes the
 * session survive an actual browser reload.
 *
 * B2B2C: the session user object carries tenantId (agency), clientId,
 * tenantStatus, clientStatus — all resolved server-side, never computed or
 * overridden here.
 */
const ROLE_HOME = {
  super_admin: "/super-admin",
  agency_admin: "/agency/clients",
  client_admin: "/admin/dashboard",
  client_employee: "/employee/dashboard",
};

export function homeForRole(role) {
  return ROLE_HOME[role] || "/auth";
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        clearAccessToken();
        setUser(null);
        return null;
      }
      const data = await res.json();
      setAccessToken(data.accessToken);
      setUser(data.user);
      return data.user;
    } catch {
      clearAccessToken();
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    bootstrap().finally(() => setLoading(false));
  }, [bootstrap]);

  // Called after Google Sign-In / dev-login / signup — the backend call
  // itself already returned {accessToken, user}; this just syncs local
  // state without a second network round trip.
  const setSession = useCallback((data) => {
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* proceed to clear local state regardless */
    }
    clearAccessToken();
    setUser(null);
  }, []);

  // Lets any page force a fresh copy of the user object after something
  // server-side changed it (e.g. branding-driven fields) without a full
  // re-bootstrap — mirrors calling bootstrapSession() again in the old app.
  const refreshUser = useCallback(async () => {
    try {
      const { user: fresh } = await authApi.me();
      setUser(fresh);
      return fresh;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, setSession, logout, refreshUser, getAccessToken }),
    [user, loading, setSession, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
