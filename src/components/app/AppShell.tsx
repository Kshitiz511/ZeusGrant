import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  LayoutDashboard,
  Compass,
  Bookmark,
  ClipboardList,
  CreditCard,
  UserCog,
  LogOut,
  FileText,
  FolderOpen,
  ListChecks,
  ShieldCheck,
  Users,
  MailCheck,
  Brain,
  Archive,
  Lock,
  ShieldAlert,

} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useModules } from "@/hooks/useModules";
import { usePlatformBanner } from "@/hooks/usePlatformBanner";
import { MODULES, money, startingPrice, type ModuleId } from "@/lib/modules";
import { ProfileStrengthIndicator } from "@/components/profile/ProfileStrengthIndicator";
import { getPlatformRole } from "@/utils/admin.functions";


const moduleNav: Record<ModuleId, { to: string; label: string; icon: typeof Compass }[]> = {
  grant_intelligence: [
    { to: "/profile", label: "Profile Intelligence", icon: Brain },
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/opportunities", label: "Opportunities", icon: Compass },
    { to: "/tracker", label: "Grant Tracker", icon: Bookmark },
    { to: "/proposals", label: "My Proposals", icon: FileText },
    { to: "/documents", label: "Documents", icon: FolderOpen },
    { to: "/reports", label: "Scans & Reports", icon: MailCheck },
    { to: "/team", label: "Team & Clients", icon: Users },
    { to: "/onboarding", label: "Organization profile", icon: ClipboardList },
  ],
  contract_compliance: [
    { to: "/compliance", label: "Contract Compliance", icon: ShieldCheck },
    { to: "/my-tasks", label: "My Tasks", icon: ListChecks },
  ],
  audit_compliance: [{ to: "/audit", label: "Audit Vault", icon: Archive }],
};

const accountNav = [
  { to: "/account", label: "Account", icon: UserCog },
  { to: "/security", label: "Security", icon: ShieldCheck },
  { to: "/billing", label: "Billing", icon: CreditCard },
] as const;






export function AppShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { states, loading: modulesLoading } = useModules(user?.id);
  const banner = usePlatformBanner();
  const fetchRole = useServerFn(getPlatformRole);
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    void fetchRole()
      .then((r) => setIsStaff(Boolean(r.role)))
      .catch(() => setIsStaff(false));
  }, [fetchRole, user?.id]);

  return (

    <div className="flex min-h-screen bg-surface-gradient">
      <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-6 lg:flex">
        <div>
          <Link to="/">
            <Logo tone="light" />
          </Link>
          <nav className="mt-10 flex flex-col gap-5" aria-label="Workspace">
            {MODULES.map((m) => {
              const active = modulesLoading || states[m.id]?.active;
              return (
                <div key={m.id}>
                  <p className="px-3 pb-1.5 text-[10px] font-bold tracking-[0.14em] text-sidebar-foreground/45 uppercase">
                    {m.name}
                  </p>
                  {active ? (
                    <div className="flex flex-col gap-1">
                      {moduleNav[m.id].map(({ to, label, icon: Icon }) => (
                        <Link
                          key={to}
                          to={to}
                          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          activeProps={{ className: "bg-sidebar-accent text-sidebar-foreground" }}
                        >
                          <Icon className="size-4" />
                          {label}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <Link
                      to="/modules/$slug"
                      params={{ slug: m.slug }}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-xs font-semibold text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    >
                      <Lock className="size-3.5" />
                      Add from {money(startingPrice(m))}/mo
                    </Link>
                  )}
                </div>
              );
            })}

            <div className="flex flex-col gap-1 border-t border-sidebar-border pt-4">
              {accountNav.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  activeProps={{ className: "bg-sidebar-accent text-sidebar-foreground" }}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              ))}
              {isStaff && (
                <Link
                  to="/admin"
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  activeProps={{ className: "bg-sidebar-accent text-sidebar-foreground" }}
                >
                  <ShieldAlert className="size-4" />
                  Admin panel
                </Link>
              )}
            </div>
          </nav>
        </div>
        <div className="space-y-3">
          <p className="truncate text-xs text-sidebar-foreground/60">{user?.email}</p>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={async () => {
              await signOut();
              void navigate({ to: "/" });
            }}
          >
            <LogOut className="mr-2 size-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-6 py-10 lg:px-8">
        <div className="w-full">
          {banner && (
            <div className="mb-6 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-semibold text-foreground">
              {banner}
            </div>
          )}
          <header className="mb-8">
            <div className="mb-4 flex justify-end">
              <ProfileStrengthIndicator />
            </div>

            <h1 className="text-3xl font-extrabold text-foreground">{title}</h1>
            {description && <p className="mt-2 text-muted-foreground">{description}</p>}
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
