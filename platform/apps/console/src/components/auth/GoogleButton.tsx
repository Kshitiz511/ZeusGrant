import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

const CORE = import.meta.env.VITE_CORE_URL ?? "/api/core";

/**
 * Google sign-in button, rendered only where the server has Google configured.
 *
 * The handler is a full page navigation rather than a fetch: the OAuth flow
 * sets a state cookie and then redirects to Google, and an XHR cannot follow
 * a cross-origin redirect into a login screen the user has to interact with.
 */
export function GoogleButton({ label }: { label: string }) {
  const enabled = useGoogleEnabled();
  if (!enabled) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => {
          window.location.href = `${CORE}/auth/google/start`;
        }}
      >
        <GoogleMark />
        {label}
      </Button>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}

/**
 * Whether this deployment can offer Google at all.
 *
 * Starts as `false` so a slow or failed probe hides the button instead of
 * flashing one that would dead-end at a Google error page.
 */
function useGoogleEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .authMethods()
      .then((m) => {
        if (!cancelled) setEnabled(m.google);
      })
      .catch(() => {
        /* no Google button; password sign-in still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

function GoogleMark() {
  return (
    <svg className="mr-2 size-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.64h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.18-2 3.44-4.96 3.44-8.57Z"
      />
      <path
        fill="#34A853"
        d="M12 23.5c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.74H1.7v2.98A11.5 11.5 0 0 0 12 23.5Z"
      />
      <path
        fill="#FBBC05"
        d="M5.55 14.18a6.9 6.9 0 0 1 0-4.36V6.84H1.7a11.5 11.5 0 0 0 0 10.32l3.85-2.98Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.69 0 3.2.58 4.4 1.72l3.3-3.3C17.72 1.3 15.1.25 12 .25A11.5 11.5 0 0 0 1.7 6.84l3.85 2.98C6.46 7.1 9 4.77 12 4.77Z"
      />
    </svg>
  );
}
