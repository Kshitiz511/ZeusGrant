import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { queryParam } from "@/lib/router";

export function LoginView({ navigate }: { navigate: (to: string) => void }) {
  const { login, isAuthenticating, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // The Google callback cannot render a React error, so it redirects back here
  // with the reason in the query string.
  const callbackError = queryParam("error");

  return (
    <AuthLayout
      heading="Welcome back"
      subheading="Sign in to your workspace."
      pitch={{
        title: "Every obligation. Every deadline. Tracked.",
        body: "Upload an award agreement and AI builds the compliance tracker for you — obligations, deadlines and financial terms, with the exact contract language behind each one.",
      }}
      footer={
        <>
          Don&apos;t have an account?{" "}
          <button
            className="font-semibold text-primary hover:underline"
            onClick={() => navigate("/signup")}
          >
            Create one
          </button>
        </>
      }
    >
      <div className="mt-8 space-y-4">
        <GoogleButton label="Sign in with Google" />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            login(email, password).catch(() => {});
          }}
          className="space-y-4"
        >
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@organization.org"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </Field>

          {(error || callbackError) && <ErrorNote>{error ?? callbackError}</ErrorNote>}

          <Button
            type="submit"
            variant="hero"
            size="lg"
            className="w-full"
            disabled={isAuthenticating}
          >
            {isAuthenticating && <Loader2 className="mr-2 size-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}
