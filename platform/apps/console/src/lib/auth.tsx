import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { api } from "./api";

// --- Security model ---------------------------------------------------------
// The tenant-scoped access token (short-lived JWT) is held ONLY in memory (a
// ref), never in local/sessionStorage — that keeps it out of reach of
// persistent XSS token theft. Consequence: a hard refresh returns you to the
// login screen. In production this is replaced by an httpOnly, Secure,
// SameSite cookie issued by a BFF; the UI never sees the token at all.

export type Identity = {
  userId: string;
  tenantId: string;
  email: string;
  tenantName: string;
  role: string;
};

type AuthState = {
  identity: Identity | null;
  isAuthenticating: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, workspaceName?: string) => Promise<void>;
  logout: () => void;
  getToken: () => string | null;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [isAuthenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared tail of login/signup: exchange the user-level token for a
  // tenant-scoped one (first tenant for now; a switcher can come later).
  const establish = useCallback(
    async (session: {
      access_token: string;
      user_id: string;
      email: string;
      tenants: { tenant_id: string; name: string; role: string }[];
    }) => {
      const first = session.tenants[0];
      if (!first) throw new Error("No workspace found for this account.");
      const scoped = await api.tenantToken(first.tenant_id, () => session.access_token);
      tokenRef.current = scoped.access_token;
      setIdentity({
        userId: session.user_id,
        tenantId: first.tenant_id,
        email: session.email,
        tenantName: first.name,
        role: scoped.role,
      });
    },
    [],
  );

  const run = useCallback(async (fn: () => Promise<void>) => {
    setAuthenticating(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      throw e;
    } finally {
      setAuthenticating(false);
    }
  }, []);

  const login = useCallback(
    (email: string, password: string) => run(async () => establish(await api.login(email, password))),
    [run, establish],
  );

  const signup = useCallback(
    (email: string, password: string, workspaceName?: string) =>
      run(async () => establish(await api.signup(email, password, workspaceName))),
    [run, establish],
  );

  const logout = useCallback(() => {
    tokenRef.current = null;
    setIdentity(null);
  }, []);

  const getToken = useCallback(() => tokenRef.current, []);

  const value = useMemo<AuthState>(
    () => ({ identity, isAuthenticating, error, login, signup, logout, getToken }),
    [identity, isAuthenticating, error, login, signup, logout, getToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
