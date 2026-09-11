import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError, asPendingVerification } from "./api";
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

/** An account that exists but has not proved its email address yet. */
export type PendingUser = { userId: string; email: string };

type AuthState = {
  identity: Identity | null;
  /**
   * Set when the account needs its address confirmed -- either just created,
   * or an existing one that never finished. Both paths land on the same
   * screen, so there is one place where a code can be entered.
   */
  pendingUser: PendingUser | null;
  /** True until the initial refresh attempt settles; render nothing meanwhile. */
  isRestoring: boolean;
  isAuthenticating: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    fullName: string,
    workspaceName?: string,
  ) => Promise<void>;
  /** Submit the emailed code. On success the user is signed in. */
  verifyEmail: (code: string) => Promise<void>;
  /** Ask for a fresh code. Resolves to the message worth showing the user. */
  resendCode: () => Promise<void>;
  /** Leave the verification screen, e.g. to sign in as somebody else. */
  cancelVerification: () => void;
  logout: () => Promise<void>;
  getToken: () => string | null;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [pendingUser, setPendingUser] = useState<PendingUser | null>(null);
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
      run(async () => {
        try {
          // Awaited inside the try so a failure to exchange the tenant token
          // is caught here rather than surfacing as an unhandled rejection.
          await establish(await api.login(email, password));
        } catch (e) {
          // An unverified account is not a failed sign-in, it is an unfinished
          // one. Send them to the code screen rather than making them guess
          // what went wrong.
          const pending = asPendingVerification(e);
          if (pending) {
            setPendingUser({ userId: pending.user_id, email: pending.email });
            await api.resendVerification(pending.user_id).catch(() => {
              /* rate-limited is fine; their existing code still works */
            });
            return;
          }
          throw e;
        }
      }),
    [run, establish],
  );

  const signup = useCallback(
    (email: string, password: string, fullName: string, workspaceName?: string) =>
      run(async () => {
        const pending = await api.signup(email, password, fullName, workspaceName);
        // No session comes back here by design, so there is nothing to
        // establish -- only an address waiting to be confirmed.
        setPendingUser({ userId: pending.user_id, email: pending.email });
      }),
    [run],
  );

  const verifyEmail = useCallback(
    (code: string) =>
      run(async () => {
        if (!pendingUser) throw new Error("There is no account waiting to be verified.");
        await establish(await api.verifyEmail(pendingUser.userId, code));
        setPendingUser(null);
      }),
    [run, establish, pendingUser],
  );

  const resendCode = useCallback(
    () =>
      run(async () => {
        if (!pendingUser) return;
        await api.resendVerification(pendingUser.userId);
      }),
    [run, pendingUser],
  );

  const cancelVerification = useCallback(() => {
    setPendingUser(null);
    setError(null);
  }, []);

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
      pendingUser,
      isRestoring,
      isAuthenticating,
      error,
      login,
      signup,
      verifyEmail,
      resendCode,
      cancelVerification,
      logout,
      getToken,
    }),
    [
      identity,
      pendingUser,
      isRestoring,
      isAuthenticating,
      error,
      login,
      signup,
      verifyEmail,
      resendCode,
      cancelVerification,
      logout,
      getToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
