import type { ReactNode } from "react";
import { BarChart3, ChevronRight, CreditCard, LogOut, Lock, Settings, Users } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { useAuth } from "@/lib/auth";
import { useActiveModules, useIsTenantAdmin } from "@/lib/hooks";
import { MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

// Enterprise console shell: navigation is for working, not selling.
// Active modules render their nav; inactive ones collapse into a single quiet
// "Available modules" group (like AWS/Azure service catalogs — discoverable,
// never pushy). Account/settings live at the bottom, user identity in a
// footer block.

export function AppShell({
  title,
  description,
  active,
  onNavigate,
  actions,
  children,
}: {
  title: string;
  description?: string;
  active: string;
  onNavigate: (key: string) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { identity, logout } = useAuth();
  const { active: activeIds } = useActiveModules();
  // Server-supplied, not read off the token: an owner who demotes someone
  // mid-session should not leave them with admin nav until they sign out.
  // This only hides links; every route behind them re-checks server-side.
  const { isAdmin } = useIsTenantAdmin();

  // Status is checked as well as entitlement. A service with no routes behind
  // it must not produce nav even if a subscription exists for it, or the
  // sidebar offers pages that cannot load.
  const isLive = (m: (typeof MODULES)[number]) =>
    m.status === "available" && activeIds.has(m.id);
  const activeModules = MODULES.filter(isLive);
  const lockedModules = MODULES.filter((m) => !isLive(m));

  const navButton = (
    key: string,
    label: string,
    Icon: React.ComponentType<{ className?: string }>,
    selected: boolean,
  ) => (
    <button
      key={key}
      onClick={() => onNavigate(key)}
      className={cn(
        "group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
        selected
          ? "bg-sidebar-accent text-sidebar-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className={cn("size-4", selected ? "text-primary-foreground" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80")} />
      {label}
    </button>
  );

  return (
    <div className="flex min-h-dvh bg-surface-gradient">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="px-6 pb-2 pt-6">
          <Logo tone="light" />
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-6" aria-label="Workspace">
          {activeModules.map((m) => (
            <div key={m.id}>
              <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/40">
                {m.name}
              </p>
              <div className="space-y-0.5">
                {m.nav.map(({ to, label, icon }) => navButton(to, label, icon, active === to))}
              </div>
            </div>
          ))}

          {lockedModules.length > 0 && (
            <div>
              <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/40">
                Available modules
              </p>
              <div className="space-y-0.5">
                {lockedModules.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onNavigate(`/modules/${m.slug}`)}
                    className="group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/80"
                  >
                    <Lock className="size-3.5 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/60" />
                    <span className="flex-1">{m.name}</span>
                    <ChevronRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-sidebar-border pt-4">
            {isAdmin && navButton("/team", "Team", Users, active === "/team")}
            {navButton("/usage", "Usage", BarChart3, active === "/usage")}
            {navButton("/billing", "Plans & Billing", CreditCard, active === "/billing")}
            {navButton("/settings", "Settings", Settings, active === "/settings")}
          </div>
        </nav>

        {/* User footer */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {(identity?.email ?? "U").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-sidebar-foreground">
                {identity?.tenantName ?? "Workspace"}
              </p>
              <p className="truncate text-[11px] text-sidebar-foreground/50">
                {identity?.email ?? ""}
              </p>
            </div>
            <button
              onClick={() => void logout()}
              title="Sign out"
              className="rounded-md p-1.5 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 py-3 lg:hidden">
          <Logo tone="light" />
          <button
            onClick={() => void logout()}
            title="Sign out"
            className="rounded-md p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="size-4" />
          </button>
        </div>

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto w-full max-w-6xl">
            {/* Mobile nav chips (sidebar hidden < lg) */}
            <div className="mb-6 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {activeModules.flatMap((m) =>
                m.nav.map(({ to, label }) => (
                  <button
                    key={to}
                    onClick={() => onNavigate(to)}
                    className={cn(
                      "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                      active === to
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                )),
              )}
            </div>

            <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-extrabold text-foreground sm:text-3xl">{title}</h1>
                {description && (
                  <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
                )}
              </div>
              {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </header>

            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
