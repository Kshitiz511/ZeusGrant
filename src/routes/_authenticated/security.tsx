import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Loader2, LogOut, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { logSecurityEvent, useSecurityLog } from "@/hooks/useSecurityLog";
import { supabase } from "@/integrations/supabase/client";
import { AUDIT_LABEL, auditCategory, type AuditCategory } from "@/lib/security";

export const Route = createFileRoute("/_authenticated/security")({
  head: () => ({
    meta: [
      { title: "Security Center | ZCS GrantMatch" },
      {
        name: "description",
        content:
          "Review your account activity trail, sign out of every device, export your organization data and manage privacy settings.",
      },
      { property: "og:title", content: "Security Center | ZCS GrantMatch" },
      {
        property: "og:description",
        content: "Account activity trail, device sign-out, data export and privacy controls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SecurityPage,
});

const EXPORT_TABLES = [
  "org_profiles",
  "org_profile_data_points",
  "person_profiles",
  "saved_opportunities",
  "grant_records",
  "proposals",
  "proposal_content_library",
  "impact_statistics",
  "compliance_contracts",
  "compliance_obligations",
  "evidence_vault_files",
  "audit_packages",
  "org_documents",
  "security_audit_log",
] as const;

const CATEGORIES: (AuditCategory | "All")[] = [
  "All",
  "Authentication",
  "Files",
  "Data",
  "Sharing",
  "Billing",
  "AI",
];

function SecurityPage() {
  const { user, session } = useAuth();
  const { entries, apiCalls, loading, refetch } = useSecurityLog(user?.id);
  const [category, setCategory] = useState<AuditCategory | "All">("All");
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (category !== "All" && auditCategory(e.action) !== category) return false;
        if (!query.trim()) return true;
        const haystack = `${AUDIT_LABEL[e.action] ?? e.action} ${e.resource_type ?? ""}`.toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      }),
    [entries, category, query],
  );

  const apiByAction = useMemo(() => {
    const map = new Map<string, number>();
    for (const call of apiCalls) map.set(call.action, (map.get(call.action) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [apiCalls]);

  async function exportData() {
    setExporting(true);
    try {
      const payload: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        account: { id: user?.id, email: user?.email },
      };
      for (const table of EXPORT_TABLES) {
        const { data } = await supabase.from(table).select("*").limit(5000);
        payload[table] = data ?? [];
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `grantmatch-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      await logSecurityEvent(user?.id, "data.exported", { metadata: { tables: EXPORT_TABLES.length } });
      await refetch();
      toast.success("Your data export has been downloaded.");
    } catch {
      toast.error("We could not build the export. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function signOutEverywhere() {
    setSigningOut(true);
    await logSecurityEvent(user?.id, "auth.signed_out_all_devices");
    const { error } = await supabase.auth.signOut({ scope: "global" });
    setSigningOut(false);
    if (error) toast.error("We could not sign out the other devices.");
  }

  async function requestDeletion() {
    await logSecurityEvent(user?.id, "account.deletion_requested", {
      metadata: { email: user?.email },
    });
    await refetch();
    toast.success("Deletion request recorded. Our team will contact you at your account email.");
  }

  const lastSignIn = entries.find((e) => e.action === "auth.signed_in");

  return (
    <AppShell
      title="Security Center"
      description="Everything that happens in your account is recorded here, permanently and unchangeably."
    >
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Activity trail</CardTitle>
                <CardDescription>
                  A permanent, append-only record. Entries can never be edited or deleted — not even
                  by you.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 size-4" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Input
                  placeholder="Search activity"
                  value={query}
                  maxLength={80}
                  onChange={(e) => setQuery(e.target.value)}
                  className="max-w-xs"
                />
                <Select value={category} onValueChange={(v) => setCategory(v as AuditCategory | "All")}>
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c === "All" ? "All activity" : c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {loading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading activity…
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-10 text-sm text-muted-foreground">
                  No activity recorded yet. Actions such as sign-ins, uploads and exports appear here
                  as you use the platform.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Record</TableHead>
                        <TableHead>Device</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {new Date(e.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-medium">
                            {AUDIT_LABEL[e.action] ?? e.action}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{auditCategory(e.action)}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {e.resource_type ?? "—"}
                          </TableCell>
                          <TableCell
                            className="max-w-[220px] truncate text-xs text-muted-foreground"
                            title={e.user_agent ?? ""}
                          >
                            {e.user_agent ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage activity (last 30 days)</CardTitle>
              <CardDescription>
                Heavy actions such as AI analysis and website scans are rate limited per hour to
                protect your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {apiByAction.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recorded usage yet.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {apiByAction.map(([action, count]) => (
                    <div key={action} className="rounded-lg border p-4">
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {action.replace(/[._]/g, " ")}
                      </p>
                      <p className="mt-1 text-2xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground">calls</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                Protection summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                "Every record is locked to your account at the database level",
                "All files are stored privately and opened through short-lived links",
                "Uploads are size- and type-checked before they are accepted",
                "Web links are screened before the platform fetches them",
                "Traffic is encrypted and hardened with strict browser protections",
              ].map((line) => (
                <p key={line} className="flex gap-2 text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-secondary" />
                  {line}
                </p>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
              <CardDescription>
                {lastSignIn
                  ? `Last recorded sign-in ${new Date(lastSignIn.created_at).toLocaleString()}.`
                  : "Your current session is active."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Signed in as {session?.user.email}. Signing out everywhere ends every other browser
                and device immediately.
              </p>
              <Button variant="outline" onClick={() => void signOutEverywhere()} disabled={signingOut}>
                {signingOut ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 size-4" />
                )}
                Sign out of all devices
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your data</CardTitle>
              <CardDescription>Download everything your account holds, in one file.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => void exportData()} disabled={exporting}>
                {exporting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Download className="mr-2 size-4" />
                )}
                Export all my data
              </Button>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">Close this account</CardTitle>
              <CardDescription>
                Deletion is handled by our team so records tied to active contracts are preserved
                correctly. We respond within 30 days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => void requestDeletion()}>
                <Trash2 className="mr-2 size-4" />
                Request account deletion
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
