import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { ErrorNote, Field } from "@/components/LoginView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

export function SignupView({ navigate }: { navigate: (to: string) => void }) {
  const { signup, isAuthenticating, error } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");

  return (
    <AuthLayout
      heading="Create your account"
      subheading="No credit card required. You can add billing later from the console."
      pitch={{
        title: "Start tracking obligations in minutes.",
        body: "Create an account, upload your first award agreement, and see every deadline and financial term laid out with the contract language behind it.",
      }}
      footer={
        <>
          Already have an account?{" "}
          <button
            className="font-semibold text-primary hover:underline"
            onClick={() => navigate("/login")}
          >
            Sign in
          </button>
        </>
      }
    >
      <div className="mt-8 space-y-4">
        <GoogleButton label="Sign up with Google" />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            signup(email, password, fullName, workspace || undefined).catch(() => {});
          }}
          className="space-y-4"
        >
          <Field label="Full name" htmlFor="fullName">
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
              required
            />
          </Field>
          <Field label="Work email" htmlFor="email">
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
              placeholder="At least 8 characters"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
          <Field label="Organization name" htmlFor="workspace">
            <Input
              id="workspace"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="Acme Nonprofit (optional)"
              autoComplete="organization"
            />
          </Field>

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button
            type="submit"
            variant="hero"
            size="lg"
            className="w-full"
            disabled={isAuthenticating}
          >
            {isAuthenticating && <Loader2 className="mr-2 size-4 animate-spin" />}
            Create account
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            By creating an account you agree to our terms and privacy policy.
          </p>
        </form>
      </div>
    </AuthLayout>
  );
}
