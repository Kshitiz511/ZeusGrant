import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

// Real email/password auth against platform-core (/auth/login, /auth/signup).
// Sign-up provisions a workspace and starts a Contract Compliance trial, so
// new users land in a working product.

export function LoginView() {
  const { login, signup, isAuthenticating, error } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const action =
      mode === "login" ? login(email, password) : signup(email, password, workspace || undefined);
    action.catch(() => {});
  };

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel — same split-screen as the legacy auth page. */}
      <div className="hidden flex-col justify-between bg-brand-gradient p-12 text-primary-foreground lg:flex">
        <Logo tone="light" />
        <div>
          <h1 className="max-w-md text-4xl font-extrabold leading-tight">
            Every obligation. Every deadline. Tracked.
          </h1>
          <p className="mt-4 max-w-md text-primary-foreground/80">
            Upload an award agreement and AI builds the compliance tracker for you — obligations,
            deadlines and financial terms, with the exact contract language behind each one.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/70">
          © {new Date().getFullYear()} Zeus Consulting · GrantMatch Innovation
        </p>
      </div>

      {/* Sign-in panel. */}
      <div className="flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-md">
          <div className="lg:hidden">
            <Logo />
          </div>
          <h2 className="mt-8 text-3xl font-extrabold text-foreground lg:mt-0">
            {mode === "login" ? "Welcome back" : "Create your workspace"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "login"
              ? "Sign in to your workspace."
              : "Free trial — no credit card required."}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground" htmlFor="workspace">
                  Organization name
                </label>
                <Input
                  id="workspace"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="Acme Nonprofit"
                  autoComplete="organization"
                />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@organization.org"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground" htmlFor="password">
                  Password
                </label>
                {mode === "login" && (
                  <button type="button" className="text-xs font-semibold text-primary hover:underline">
                    Forgot password?
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={mode === "signup" ? 8 : undefined}
                required
              />
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" variant="hero" size="lg" className="w-full" disabled={isAuthenticating}>
              {isAuthenticating && <Loader2 className="mr-2 size-4 animate-spin" />}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  className="font-semibold text-primary hover:underline"
                  onClick={() => setMode("signup")}
                >
                  Start free trial
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  className="font-semibold text-primary hover:underline"
                  onClick={() => setMode("login")}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </main>
  );
}
