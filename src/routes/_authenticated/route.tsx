import { useEffect, useRef } from "react";
import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  // Keep the query string (e.g. /billing?plan=growth&annual=true) so the user
  // lands back on exactly what they asked for after signing in.
  const location = useRouterState({
    select: (s) => `${s.location.pathname}${s.location.searchStr ?? ""}`,
  });
  // Remember the page they asked for the first time only: during the
  // transition to /auth this layout is still mounted, and re-reading the live
  // location would nest /auth?next=/auth?next=... forever.
  const targetRef = useRef(location);
  const redirected = useRef(false);

  useEffect(() => {
    if (loading || session || redirected.current) return;
    if (targetRef.current.startsWith("/auth")) return;
    redirected.current = true;
    void navigate({ to: "/auth", search: { next: targetRef.current, mode: "signin" } });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return <Outlet />;
}

