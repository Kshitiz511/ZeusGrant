import { useEffect, useRef, useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ErrorNote } from "@/components/LoginView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

/** Seconds to wait before the resend button becomes usable again. */
const RESEND_COOLDOWN_S = 30;

export function VerifyEmailView() {
  const { pendingUser, verifyEmail, resendCode, cancelVerification, isAuthenticating, error } =
    useAuth();
  const [code, setCode] = useState("");
  const [resentAt, setResentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // The code box is the only thing on this screen worth touching, so put the
  // cursor in it rather than making every user click first.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A visible countdown is kinder than a button that silently does nothing.
  // The server enforces its own hourly limit regardless; this only stops
  // people hammering it in the first few seconds.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!pendingUser) return null;

  const submit = () => {
    if (code.length !== 6) return;
    void verifyEmail(code).catch(() => {
      // The message is already in `error`. Clear the box so the next attempt
      // starts clean instead of editing a code that is known to be wrong.
      setCode("");
      inputRef.current?.focus();
    });
  };

  return (
    <AuthLayout
      heading="Check your email"
      subheading={`We sent a 6-digit code to ${pendingUser.email}. Enter it below to finish setting up your account.`}
      pitch={{
        title: "One quick step, then you're in.",
        body: "Confirming your address keeps your workspace yours, and means deadline reminders reach an inbox you actually read.",
      }}
      footer={
        <>
          Wrong address, or want a different account?{" "}
          <button
            className="font-semibold text-primary hover:underline"
            onClick={cancelVerification}
          >
            Start over
          </button>
        </>
      }
    >
      <div className="mt-8 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="code">
              Verification code
            </label>
            <Input
              ref={inputRef}
              id="code"
              value={code}
              // inputMode/pattern bring up the number pad on a phone; the
              // strip guards against a pasted code that carries spaces.
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="text-center text-2xl tracking-[0.5em] font-mono"
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(next);
              }}
              required
            />
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          {resentAt && !error && (
            <p className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
              <MailCheck className="size-4 shrink-0" />
              New code sent. The previous one no longer works.
            </p>
          )}

          <Button
            type="submit"
            variant="hero"
            size="lg"
            className="w-full"
            disabled={isAuthenticating || code.length !== 6}
          >
            {isAuthenticating && <Loader2 className="mr-2 size-4 animate-spin" />}
            Verify and continue
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          Didn&apos;t get it? Check spam, then{" "}
          <button
            type="button"
            className="font-semibold text-primary hover:underline disabled:opacity-50 disabled:no-underline"
            disabled={isAuthenticating || cooldown > 0}
            onClick={() => {
              void resendCode()
                .then(() => {
                  setResentAt(Date.now());
                  setCooldown(RESEND_COOLDOWN_S);
                  setCode("");
                })
                .catch(() => {
                  /* the reason is in `error` */
                });
            }}
          >
            send a new code
          </button>
          {cooldown > 0 && ` (${cooldown}s)`}
        </div>
      </div>
    </AuthLayout>
  );
}
