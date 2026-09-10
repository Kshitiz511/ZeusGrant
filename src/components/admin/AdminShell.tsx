import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  Bot,
  ClipboardList,
  Bug,
  Settings,
  ArrowLeft,
  ShieldAlert,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getPlatformRole, type PlatformRole } from "@/utils/admin.functions";

const adminNav = [
  { to: "/admin", label: "System Dashboard", icon: BarChart3, exact: true },
  { to: "/admin/organizations", label: "Organizations", icon: Building2 },
  { to: "/admin/ai-jobs", label: "AI Job Monitor", icon: Bot },
  { to: "/admin/errors", label: "Error Log", icon: Bug },
  { to: "/admin/audit", label: "Audit Log", icon: ClipboardList },
  { to: "/admin/settings", label: "Platform Settings", icon: Settings },
] as const;

/** Loads the signed-in user's platform role and redirects anyone who is not staff. */
export function usePlatformRole() {
  const fetchRole = useServerFn(getPlatformRole);
  const navigate = useNavigate();
  const [role, setRole] = useState<PlatformRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchRole()
      .then((res) => {
        if (cancelled) return;
        setRole(res.role);
        setLoading(false);
        if (!res.role) void navigate({ to: "/" });
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        void navigate({ to: "/" });
      });
    return () => {
      cancelled = true;
    };
  }, [fetchRole, navigate]);

  return { role, loading, isAdmin: role === "platform_admin" };
}

export function AdminShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { role, loading } = usePlatformRole();

  return (
    <div className="flex min-h-screen bg-surface-gradient">
      <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-6 lg:flex">
        <div>
          <p className="flex items-center gap-2 text-sm font-extrabold tracking-tight text-sidebar-foreground">
            <ShieldAlert className="size-4" /> Admin Panel
          </p>
          <nav className="mt-8 flex flex-col gap-1" aria-label="Admin">
            {adminNav.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/admin" }}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                activeProps={{ className: "bg-sidebar-accent text-sidebar-foreground" }}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <Link
          to="/dashboard"
          className="flex items-center gap-2 text-xs font-semibold text-sidebar-foreground/60 hover:text-sidebar-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to app
        </Link>
      </aside>

      <main className="min-w-0 flex-1 px-6 py-10 lg:px-8">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-foreground">{title}</h1>
            {description && <p className="mt-2 text-muted-foreground">{description}</p>}
            {role === "platform_support" && (
              <p className="mt-2 text-xs font-semibold text-muted-foreground">
                Support role — read-only access to most tools.
              </p>
            )}
          </div>
          {actions}
        </header>
        {loading ? (
          <p className="text-sm text-muted-foreground">Checking your access…</p>
        ) : role ? (
          children
        ) : null}
      </main>
    </div>
  );
}
