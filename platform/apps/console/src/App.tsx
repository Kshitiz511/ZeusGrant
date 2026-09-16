import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { ActivityView } from "@/components/ActivityView";
import { AppShell } from "@/components/AppShell";
import { BillingView } from "@/components/BillingView";
import { ContractDetail } from "@/components/ContractDetail";
import { ContractsView } from "@/components/ContractsView";
import { FundingProfileView } from "@/components/FundingProfileView";
import { LoginView } from "@/components/LoginView";
import { MatchesView } from "@/components/MatchesView";
import { SettingsView } from "@/components/SettingsView";
import { SignupView } from "@/components/SignupView";
import { LandingPage } from "@/components/site/LandingPage";
import { TasksView } from "@/components/TasksView";
import { TeamView } from "@/components/TeamView";
import { Button } from "@/components/ui/button";
import { UsageView } from "@/components/UsageView";
import { VerifyEmailView } from "@/components/VerifyEmailView";
import { useAuth } from "@/lib/auth";
import { useActiveModules, useContracts } from "@/lib/hooks";
import { MODULES, moduleForRoute } from "@/lib/modules";
import { useRoute } from "@/lib/router";
import type { Contract } from "@/lib/types";

type View =
  | { kind: "route"; key: string }
  // Stored by id, not by value: uploading a document rewrites the contract
  // body, so the detail view must read the refreshed record from the cache
  // rather than a snapshot taken at click time.
  | { kind: "contract"; contractId: string };

const ROUTE_META: Record<string, { title: string; description?: string }> = {
  "/matches": {
    title: "Matches",
    description:
      "Open funding scored against your profile, with the reasons behind every score.",
  },
  "/funding-profile": {
    title: "Funding profile",
    description: "What we score opportunities against. The more complete it is, the sharper the matches.",
  },
  "/compliance": {
    title: "Contract Compliance",
    description:
      "Upload contracts and let AI extract every obligation, deadline and financial term.",
  },
  "/my-tasks": {
    title: "My Tasks",
    description: "Every obligation across your contracts, in one queue.",
  },
  "/activity": {
    title: "Activity",
    description: "An append-only record of everything your team has done here.",
  },
  "/billing": {
    title: "Plans & Billing",
    description: "Choose a plan for each module, or manage your existing subscription.",
  },
  "/team": {
    title: "Team",
    description: "Who can get into this workspace, and what they are allowed to do.",
  },
  "/usage": {
    title: "Usage",
    description: "AI work done for this workspace, and what it cost.",
  },
  "/settings": { title: "Settings", description: "Workspace, security and billing preferences." },
};

export default function App() {
  const { identity, pendingUser, isRestoring } = useAuth();
  const [path, navigate] = useRoute();
  const [view, setView] = useState<View>({ kind: "route", key: "/compliance" });

  // A signed-in user sitting on a public URL has just finished logging in.
  // Rewriting the address stops the back button from returning them to a login
  // form they no longer need. This runs as an effect, not during render, and
  // sits above the early returns so the hook order never changes.
  const onPublicPath = path === "/" || path === "/login" || path === "/signup";
  useEffect(() => {
    if (identity && onPublicPath) navigate("/app", { replace: true });
  }, [identity, onPublicPath, navigate]);

  // The session cookie is checked before first paint. Showing the login form
  // during that round-trip would flash it at users who are already signed in.
  if (isRestoring) return <Restoring />;

  if (!identity) {
    // Takes precedence over the login and signup forms: the account already
    // exists, and sending them back to a form they just completed would look
    // like the signup failed.
    if (pendingUser) return <VerifyEmailView />;
    if (path === "/login") return <LoginView navigate={navigate} />;
    if (path === "/signup") return <SignupView navigate={navigate} />;
    // Anything else, including deep links into the console, lands on the
    // marketing page rather than a 404. The deep link is lost, but a stranger
    // seeing the product beats a stranger seeing an error.
    return <LandingPage onNavigate={navigate} />;
  }

  return <Authed view={view} setView={setView} />;
}

function Restoring() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <span className="sr-only">Restoring your session</span>
    </div>
  );
}

function Authed({ view, setView }: { view: View; setView: (v: View) => void }) {
  const { active, isLoading } = useActiveModules();
  const { data: contracts } = useContracts();

  const navigate = (key: string) => setView({ kind: "route", key });

  // The default landing route is Contract Compliance, which is wrong for a
  // tenant who only bought Grant Intelligence. Once entitlements arrive, move
  // them to the first service they actually have. Only fires while they are
  // still on the untouched default, so it never fights a real navigation.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || isLoading || active.size === 0) return;
    landed.current = true;
    if (view.kind === "route" && view.key === "/compliance" && !active.has("contract_compliance")) {
      const first = MODULES.find((m) => active.has(m.id));
      if (first?.nav[0]) setView({ kind: "route", key: first.nav[0].to });
    }
  }, [isLoading, active, view, setView]);
  const openContract =
    view.kind === "contract"
      ? contracts?.find((c) => c.id === view.contractId) ?? null
      : null;

  const activeKey = view.kind === "contract" ? "/compliance" : view.key;
  const meta =
    view.kind === "contract"
      ? {
          title: openContract?.title ?? "Contract",
          description: openContract?.counterparty || undefined,
        }
      : ROUTE_META[view.key] ?? moduleMeta(view.key);

  // A route no module claims is platform-wide and needs no subscription,
  // which is what keeps Billing reachable for a tenant who has bought nothing.
  const owner = view.kind === "contract" ? moduleForRoute("/compliance") : moduleForRoute(view.key);
  const locked = !!owner && !active.has(owner.id);

  return (
    <AppShell
      title={meta.title}
      description={meta.description}
      active={activeKey}
      onNavigate={navigate}
    >
      {isLoading ? null : locked ? (
        <NoAccess module={owner!.name} onViewPlans={() => navigate("/billing")} />
      ) : view.kind === "contract" ? (
        openContract ? (
          <ContractDetail
            contract={openContract}
            onBack={() => setView({ kind: "route", key: "/compliance" })}
          />
        ) : null
      ) : view.key === "/matches" ? (
        <MatchesView onNavigate={navigate} />
      ) : view.key === "/funding-profile" ? (
        <FundingProfileView onNavigate={navigate} />
      ) : view.key === "/compliance" ? (
        <ContractsView
          onOpen={(c: Contract) => setView({ kind: "contract", contractId: c.id })}
        />
      ) : view.key === "/my-tasks" ? (
        <TasksView />
      ) : view.key === "/activity" ? (
        <ActivityView />
      ) : view.key === "/billing" ? (
        <BillingView />
      ) : view.key === "/team" ? (
        <TeamView />
      ) : view.key === "/usage" ? (
        <UsageView />
      ) : view.key === "/settings" ? (
        <SettingsView onNavigate={navigate} />
      ) : (
        <ComingSoon onBack={() => navigate("/billing")} />
      )}
    </AppShell>
  );
}

function moduleMeta(key: string): { title: string; description?: string } {
  const mod = MODULES.find((m) => key === `/modules/${m.slug}`);
  if (mod) {
    return {
      title: mod.name,
      description: "This module isn't part of your plan yet. Contact your account owner to enable it.",
    };
  }
  return { title: "Zeus Platform" };
}

function NoAccess({ module, onViewPlans }: { module: string; onViewPlans: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <ShieldCheck className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-bold text-foreground">{module} isn&apos;t enabled</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Your workspace doesn&apos;t have an active entitlement for this module yet. Each service is
        sold on its own, so you only pay for the ones you use.
      </p>
      <Button className="mt-5" onClick={onViewPlans}>
        View plans
      </Button>
    </div>
  );
}

function ComingSoon({ onBack }: { onBack: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <h2 className="text-lg font-bold text-foreground">Nothing here yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        This page isn&apos;t part of any service you have open. Pick a service from the sidebar, or
        see what else the platform offers.
      </p>
      <Button variant="outline" className="mt-5" onClick={onBack}>
        View plans
      </Button>
    </div>
  );
}
