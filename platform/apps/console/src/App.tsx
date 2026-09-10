import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ContractDetail } from "@/components/ContractDetail";
import { ContractsView } from "@/components/ContractsView";
import { LoginView } from "@/components/LoginView";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useModuleAccess } from "@/lib/hooks";
import { MODULES } from "@/lib/modules";
import type { Contract } from "@/lib/types";

type View =
  | { kind: "route"; key: string }
  | { kind: "contract"; contract: Contract };

const ROUTE_META: Record<string, { title: string; description?: string }> = {
  "/compliance": {
    title: "Contract Compliance",
    description:
      "Upload contracts and let AI extract every obligation, deadline and financial term.",
  },
  "/my-tasks": { title: "My Tasks", description: "Obligations assigned to you across contracts." },
  "/settings": { title: "Settings", description: "Workspace, security and billing preferences." },
};

export default function App() {
  const { identity } = useAuth();
  const [view, setView] = useState<View>({ kind: "route", key: "/compliance" });

  if (!identity) return <LoginView />;
  return <Authed view={view} setView={setView} />;
}

function Authed({ view, setView }: { view: View; setView: (v: View) => void }) {
  const { hasAccess, isLoading } = useModuleAccess();

  const navigate = (key: string) => setView({ kind: "route", key });
  const activeKey = view.kind === "contract" ? "/compliance" : view.key;
  const meta =
    view.kind === "contract"
      ? { title: view.contract.title, description: view.contract.counterparty || undefined }
      : ROUTE_META[view.key] ?? moduleMeta(view.key);

  return (
    <AppShell
      title={meta.title}
      description={meta.description}
      active={activeKey}
      onNavigate={navigate}
    >
      {view.kind === "contract" ? (
        <ContractDetail
          contract={view.contract}
          onBack={() => setView({ kind: "route", key: "/compliance" })}
        />
      ) : view.key === "/compliance" ? (
        isLoading ? null : hasAccess ? (
          <ContractsView onOpen={(c) => setView({ kind: "contract", contract: c })} />
        ) : (
          <NoAccess />
        )
      ) : (
        <ComingSoon onBack={() => navigate("/compliance")} />
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

function NoAccess() {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <ShieldCheck className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-bold text-foreground">Contract Compliance isn&apos;t enabled</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Your workspace doesn&apos;t have an active entitlement for this module. Ask your account
        owner to enable it from billing.
      </p>
    </div>
  );
}

function ComingSoon({ onBack }: { onBack: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <h2 className="text-lg font-bold text-foreground">Coming soon</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        This area is being migrated to the new platform. In the meantime, everything you need for
        contract compliance is ready.
      </p>
      <Button variant="outline" className="mt-5" onClick={onBack}>
        Back to Contract Compliance
      </Button>
    </div>
  );
}
