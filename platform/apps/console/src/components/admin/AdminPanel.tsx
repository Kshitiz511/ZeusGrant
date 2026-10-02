// The platform-admin console: one pane of glass across every tenant.
//
// Distinct from the Team view, which is a *tenant* admin managing their own
// workspace. Nothing here is scoped to a tenant; it is the operator's view of
// the whole platform, and every route behind it requires `platform_admin`.
//
// Numbers shown here are read from real endpoints. Where a figure is not yet
// available the section says so rather than displaying a zero -- the legacy
// admin dashboard hardcoded "operational" service health and defaulted AI
// success to 100%, which is worse than showing nothing because it cannot be
// told apart from a working system.

import { useState } from "react";
import {
  Activity,
  Boxes,
  Building2,
  Cpu,
  FileClock,
  LayoutDashboard,
  Settings2,
} from "lucide-react";
import { AdminAudit } from "@/components/admin/AdminAudit";
import { AdminConfig } from "@/components/admin/AdminConfig";
import { AdminModels } from "@/components/admin/AdminModels";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { AdminPlans } from "@/components/admin/AdminPlans";
import { AdminQueue } from "@/components/admin/AdminQueue";
import { AdminTenants } from "@/components/admin/AdminTenants";
import { Button } from "@/components/ui/button";
import { useIsPlatformAdmin } from "@/lib/admin-hooks";
import { cn } from "@/lib/utils";

type SectionId =
  | "overview"
  | "tenants"
  | "plans"
  | "models"
  | "queue"
  | "config"
  | "audit";

const SECTIONS: {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, blurb: "Platform at a glance." },
  { id: "tenants", label: "Tenants", icon: Building2, blurb: "Every workspace, and what it is allowed to do." },
  { id: "plans", label: "Plans & pricing", icon: Boxes, blurb: "What is for sale, and for how much." },
  { id: "models", label: "AI models", icon: Cpu, blurb: "Model prices, and models running unpriced." },
  { id: "queue", label: "Queue", icon: Activity, blurb: "Background work, failures and stuck leases." },
  { id: "config", label: "Config", icon: Settings2, blurb: "Dashboard-managed settings and caches." },
  { id: "audit", label: "Audit", icon: FileClock, blurb: "Every administrative action taken here." },
];

export function AdminPanel({ onExit }: { onExit: () => void }) {
  const [section, setSection] = useState<SectionId>("overview");
  const { isPlatformAdmin, isLoading } = useIsPlatformAdmin();

  // The server rejects these routes regardless, but rendering the chrome to
  // someone who cannot use it just produces a screen full of failed requests.
  if (isLoading) return null;
  if (!isPlatformAdmin) return <NotAnAdmin onExit={onExit} />;

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Zeus Platform
            </p>
            <h1 className="text-lg font-bold text-foreground">Operator console</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onExit}>
            Back to workspace
          </Button>
        </div>
        <div className="mx-auto max-w-7xl overflow-x-auto px-6">
          <nav className="flex gap-1" aria-label="Admin sections">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                aria-current={section === id ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  section === id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-foreground">{current.label}</h2>
          <p className="text-sm text-muted-foreground">{current.blurb}</p>
        </div>

        {section === "overview" && <AdminOverview onJump={setSection} />}
        {section === "tenants" && <AdminTenants />}
        {section === "plans" && <AdminPlans />}
        {section === "models" && <AdminModels />}
        {section === "queue" && <AdminQueue />}
        {section === "config" && <AdminConfig />}
        {section === "audit" && <AdminAudit />}
      </main>
    </div>
  );
}

function NotAnAdmin({ onExit }: { onExit: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md rounded-xl border border-dashed border-border p-10 text-center">
        <h2 className="text-lg font-bold text-foreground">Not available</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is for platform operators. Your account administers its own workspace, which
          you can manage from Team.
        </p>
        <Button className="mt-5" onClick={onExit}>
          Back to workspace
        </Button>
      </div>
    </div>
  );
}
