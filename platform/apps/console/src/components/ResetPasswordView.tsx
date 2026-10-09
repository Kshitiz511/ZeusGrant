import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ErrorNote, Field } from "@/components/LoginView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

const PITCH = {
  title: "Your data stays yours.",
  body: "Reset codes expire in 15 minutes, and resetting your password signs out every session on every device.",
};

type Stage = "request" | "reset" | "done";

/**
 * Two steps: ask for a code, then trade it for a new password.
 *
 * The first step always "succeeds" -- the server will not say whether the
 * address has an account -- so the copy says "if an account exists".
 */
export function ResetPasswordView({ navigate }: { navigate: (to: string) => void }) {
  const [stage, setStage] = useState<Stage>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const requestCode = () =>
    run(async () => {
      await api.forgotPassword(email.trim());
      setNotice(null);
      setStage("reset");
    });

  const submitReset = () =>
    run(async () => {
      if (password !== confirm) throw new Error("The passwords don't match.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      await api.resetPassword(email.trim(), code.trim(), password);
      setStage("done");
    });

  const backToLogin = (
    <>
      Remembered it?{" "}
      <button
        className="font-semibold text-primary hover:underline"
        onClick={() => navigate("/login")}
      >
        Sign in
      </button>
    </>
  );

  if (stage === "done") {
    return (
      <AuthLayout pitch={PITCH}
        heading="Password updated"
        subheading="You've been signed out everywhere. Sign in with your new password."
        footer={null}
      >
        <Button variant="hero" size="lg" className="mt-8 w-full" onClick={() => navigate("/login")}>
          Go to sign in
        </Button>
      </AuthLayout>
    );
  }

  if (stage === "request") {
    return (
      <AuthLayout pitch={PITCH}
        heading="Reset your password"
        subheading="Enter your account email and we'll send you a 6-digit code."
        footer={backToLogin}
      >
        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
          }}
        >
          <Field label="Email" htmlFor="reset-email">
            <Input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@organization.org"
              autoComplete="email"
              required
            />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Send code
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout pitch={PITCH}
      heading="Check your email"
      subheading={`If an account exists for ${email.trim()}, we've sent a 6-digit code. It expires in 15 minutes.`}
      footer={backToLogin}
    >
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submitReset();
        }}
      >
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
          <MailCheck className="size-4 text-primary" />
          Check spam if it hasn't arrived within a minute.
        </div>
        <Field label="Code" htmlFor="reset-code">
          <Input
            id="reset-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            required
          />
        </Field>
        <Field label="New password" htmlFor="reset-password">
          <Input
            id="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <Field label="Confirm new password" htmlFor="reset-confirm">
          <Input
            id="reset-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
          Set new password
        </Button>
        <button
          type="button"
          className="w-full text-sm text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.forgotPassword(email.trim());
              setNotice("A new code is on its way. Earlier codes no longer work.");
            })
          }
        >
          Send a new code
        </button>
      </form>
    </AuthLayout>
  );
}
