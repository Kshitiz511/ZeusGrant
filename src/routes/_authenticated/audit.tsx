import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuditReadinessGauge } from "@/components/audit/AuditReadinessGauge";
import { useAuth } from "@/hooks/useAuth";
import { useAllEvidence } from "@/hooks/useAuditVault";
import { useAllObligations, useContracts } from "@/hooks/useCompliance";
import { auditReadiness, BAND_CLASS, BAND_LABEL } from "@/lib/audit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit Vault | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Timestamped, hashed evidence for every contract obligation, plus audit-ready documentation packages.",
      },
      { property: "og:title", content: "Audit Vault | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "Prove compliance with an evidence vault, readiness score and formal audit packages.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuditVaultOverview,
});

function AuditVaultOverview() {
  const { user } = useAuth();
  const { contracts, loading } = useContracts(user?.id);
  const { obligations } = useAllObligations(user?.id);
  const { evidence } = useAllEvidence(user?.id);

  const rows = useMemo(
    () =>
      contracts
        .filter((c) => !c.archived)
        .map((c) => ({
          contract: c,
          readiness: auditReadiness(
            obligations.filter((o) => o.contract_id === c.id),
            evidence.filter((e) => e.contract_id === c.id),
          ),
          files: evidence.filter((e) => e.contract_id === c.id).length,
        })),
    [contracts, obligations, evidence],
  );

  const overall = useMemo(() => auditReadiness(obligations, evidence), [obligations, evidence]);

  return (
    <AppShell
      title="Audit Vault"
      description="Evidence, readiness and formal documentation packages for every contract."
    >
      {loading ? (
        <Loader2 className="size-5 animate-spin text-primary" />
      ) : (
        <div className="space-y-8">
          <div className="rounded-xl border border-border bg-card p-6">
            <AuditReadinessGauge readiness={overall} />
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <ShieldCheck className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                Add a contract in the Contract Compliance Manager and its evidence vault appears here.
              </p>
              <Button className="mt-4" asChild>
                <Link to="/compliance">Go to contracts</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {rows.map(({ contract, readiness, files }) => (
                <Link
                  key={contract.id}
                  to="/compliance/$id"
                  params={{ id: contract.id }}
                  className="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-soft"
                >
                  <p className="truncate text-sm font-bold text-foreground">{contract.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{contract.funder}</p>
                  <Badge variant="outline" className={cn("mt-3", BAND_CLASS[readiness.band])}>
                    {BAND_LABEL[readiness.band]} · {readiness.score}%
                  </Badge>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {files} evidence file{files === 1 ? "" : "s"} ·{" "}
                    {readiness.missing.length} missing
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
