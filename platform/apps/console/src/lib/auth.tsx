import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "./api";
import type { SessionResponse } from "./types";

// --- Security model ---------------------------------------------------------
// The tenant-scoped access token (short-lived JWT) is held ONLY in memory (a
// ref), never in local/sessionStorage — that keeps it out of reach of
// persistent XSS token theft.
//
// Durability across a reload comes from a refresh token the browser stores in
// an httpOnly, Secure, SameSite cookie that script cannot read. On mount we
// call POST /auth/refresh once: if the cookie is live we silently restore the
// session, otherwise we fall through to the login screen. The server rotates
// the cookie on every refresh and revokes the whole family if a rotated token
// is ever replayed, so a stolen cookie has a short and noisy life.
//
// Access tokens last an hour; we renew a few minutes early so a long working
// session never sees a spurious 401.

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const RENEW_MARGIN_MS = 5 * 60 * 1000;

export type Identity = {
  userId: string;
  tenantId: string;
  email: string;
  tenantName: string;
  role: string;
};

type AuthState = {
  identity: Identity | null;
  /** True until the initial refresh attempt settles; render nothing meanwhile. */
  isRestoring: boolean;
  isAuthenticating: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, workspaceName?: string) => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => string | null;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [isRestoring, setRestoring] = useState(true);
  const [isAuthenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared tail of login/signup/refresh: exchange the user-level token for a
  // tenant-scoped one (first tenant for now; a switcher can come later).
  const establish = useCallback(async (session: SessionResponse) => {
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
  }, []);

  const clear = useCallback(() => {
    tokenRef.current = null;
    setIdentity(null);
  }, []);

  // Restore an existing session on first paint, and keep renewing it while the
  // tab stays open. A 401 here is the normal "not signed in" case, so it is
  // swallowed rather than surfaced as an error.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const renew = async () => {
      try {
        const session = await api.refresh();
        if (cancelled) return;
        await establish(session);
        if (!cancelled) timer = setTimeout(renew, ACCESS_TOKEN_TTL_MS - RENEW_MARGIN_MS);
      } catch (e) {
        if (cancelled) return;
        clear();
        // Anything other than "no valid session" is worth showing; a failed
        // renewal mid-session should not look like a silent logout.
        if (!(e instanceof ApiError && e.status === 401)) {
          setError(e instanceof Error ? e.message : "Your session could not be restored.");
        }
      } finally {
        if (!cancelled) setRestoring(false);
      }
    };

    void renew();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [establish, clear]);

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
    (email: string, password: string) =>
      run(async () => establish(await api.login(email, password))),
    [run, establish],
  );

  const signup = useCallback(
    (email: string, password: string, workspaceName?: string) =>
      run(async () => establish(await api.signup(email, password, workspaceName))),
    [run, establish],
  );

  const logout = useCallback(async () => {
    // Clear locally first so the UI never appears logged in after the click,
    // then revoke server-side; a failed network call must not trap the user in
    // a session they asked to end.
    clear();
    try {
      await api.logout();
    } catch {
      /* best effort — the cookie is short-lived and rotates regardless */
    }
  }, [clear]);

  const getToken = useCallback(() => tokenRef.current, []);

  const value = useMemo<AuthState>(
    () => ({
      identity,
      isRestoring,
      isAuthenticating,
      error,
      login,
      signup,
      logout,
      getToken,
    }),
    [identity, isRestoring, isAuthenticating, error, login, signup, logout, getToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
