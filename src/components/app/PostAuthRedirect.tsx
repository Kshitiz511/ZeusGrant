import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";

/**
 * After a social sign-in round-trip the provider returns the user to the app
 * origin. Send them on to the page they originally asked for.
 */
export function PostAuthRedirect() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading || !session || pathname !== "/") return;
    const next = sessionStorage.getItem("zcs:next");
    if (!next || !next.startsWith("/") || next.startsWith("//")) return;
    sessionStorage.removeItem("zcs:next");
    void navigate({ href: next });
  }, [loading, session, pathname, navigate]);

  return null;
}
