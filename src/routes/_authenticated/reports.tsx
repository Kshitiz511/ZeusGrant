import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, Loader2, Mail, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app/AppShell";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useEmailReports } from "@/hooks/useEmailReports";
import { useFundingScan } from "@/hooks/useFundingScan";
import { SCAN_LABEL, formatWhen } from "@/lib/scans";
import { sendOpportunityReportNow } from "@/utils/reports.functions";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Scans & Reports | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content: "Funding scan cadence, scheduled email opportunity reports and usage analytics.",
      },
      { property: "og:title", content: "Scans & Reports | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "See when your funding scans run and email opportunity reports to your team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { user } = useAuth();
  const ent = useEntitlements(user?.id);
  const frequency = ent.limits.scan_frequency;
  const scan = useFundingScan(user?.id, frequency);
  const reports = useEmailReports(user?.id);
  const sendNow = useServerFn(sendOpportunityReportNow);

  const [recipients, setRecipients] = useState("");
  const [minScore, setMinScore] = useState("60");
  const [sending, setSending] = useState(false);
  const [analytics, setAnalytics] = useState<{ proposals: number; drafts: number; awarded: number } | null>(
    null,
  );

  useEffect(() => {
    setRecipients((reports.settings?.recipients ?? []).join(", "));
    setMinScore(String(reports.settings?.min_fit_score ?? 60));
  }, [reports.settings]);

  useEffect(() => {
    if (!user?.id || !ent.limits.usage_analytics) return;
    void (async () => {
      const [p, e, g] = await Promise.all([
        supabase.from("proposals").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase
          .from("proposal_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("event", "proposal.draft_generated"),
        supabase
          .from("grant_records")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("outcome", "awarded"),
      ]);
      setAnalytics({ proposals: p.count ?? 0, drafts: e.count ?? 0, awarded: g.count ?? 0 });
    })();
  }, [user?.id, ent.limits.usage_analytics]);

  const saveSettings = async (enabled: boolean) => {
    try {
      await reports.save({
        enabled,
        frequency,
        recipients: recipients
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        min_fit_score: Number(minScore) || 60,
      });
      toast.success("Report schedule saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  };

  const runManualScan = async () => {
    const { count } = await supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    await scan.recordScan(count ?? 0, count ?? 0, "manual");
    toast.success("Funding scan complete.");
  };

  const emailNow = async () => {
    setSending(true);
    try {
      const res = await sendNow({});
      if (res.status === "sent") toast.success(`Report emailed to ${res.sent} recipient(s).`);
      else if (res.status === "not_configured")
        toast.info("Report generated and logged. Email delivery turns on once a sender domain is verified.");
      else toast.error("The email provider rejected the report.");
      await reports.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send report");
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell
      title="Scans & reports"
      description="Your funding scan cadence, scheduled email reports and usage analytics."
    >
      <SubscriptionGate loading={ent.loading} hasAccess={ent.hasAccess} feature="Scans and reports">
        <div className="space-y-8">
          <section className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">{SCAN_LABEL[frequency]}</h2>
                <p className="text-sm text-muted-foreground">
                  Last scan:{" "}
                  {scan.lastRunAt ? formatWhen(new Date(scan.lastRunAt)) : "not run yet"} · Next scan:{" "}
                  {formatWhen(scan.nextScanAt)}
                </p>
              </div>
              <Button variant="outline" onClick={() => void runManualScan()}>
                <RefreshCw className="mr-2 size-4" /> Run scan now
              </Button>
            </div>
            <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border text-sm">
              {scan.runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between p-3">
                  <span className="text-muted-foreground">{formatWhen(new Date(r.created_at))}</span>
                  <span className="text-foreground">{r.matches_found} opportunities scanned</span>
                  <Badge variant="secondary" className="capitalize">
                    {r.scan_type}
                  </Badge>
                </li>
              ))}
              {!scan.runs.length && <li className="p-4 text-muted-foreground">No scans recorded yet.</li>}
            </ul>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold text-foreground">Email opportunity reports</h2>
            {!ent.limits.email_reports ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Scheduled email reports are included on Growth and above.
              </p>
            ) : (
              <>
                <div className="mt-4 flex items-center gap-3">
                  <Switch
                    id="reports-enabled"
                    checked={reports.settings?.enabled ?? false}
                    onCheckedChange={(v) => void saveSettings(v)}
                  />
                  <Label htmlFor="reports-enabled">
                    Send me a {frequency} report of new matching opportunities
                  </Label>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="recipients">Additional recipients</Label>
                    <Input
                      id="recipients"
                      placeholder="grants@org.org, ed@org.org"
                      value={recipients}
                      onChange={(e) => setRecipients(e.target.value)}
                      onBlur={() => void saveSettings(reports.settings?.enabled ?? false)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="minscore">Minimum fit score</Label>
                    <Select
                      value={minScore}
                      onValueChange={(v) => {
                        setMinScore(v);
                      }}
                    >
                      <SelectTrigger id="minscore">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["40", "50", "60", "70", "80"].map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}% and above
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void saveSettings(reports.settings?.enabled ?? true)}>
                    <Mail className="mr-2 size-4" /> Save schedule
                  </Button>
                  <Button variant="hero" disabled={sending} onClick={() => void emailNow()}>
                    {sending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 size-4" />
                    )}
                    Send report now
                  </Button>
                </div>

                <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border text-sm">
                  {reports.log.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <span className="text-muted-foreground">{formatWhen(new Date(l.created_at))}</span>
                      <span className="truncate text-foreground">{l.recipient}</span>
                      <span className="text-muted-foreground">{l.opportunity_count} matches</span>
                      <Badge variant={l.status === "sent" ? "default" : "secondary"}>{l.status}</Badge>
                    </li>
                  ))}
                  {!reports.log.length && (
                    <li className="p-4 text-muted-foreground">No reports sent yet.</li>
                  )}
                </ul>
              </>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <BarChart3 className="size-4" /> Usage analytics
            </h2>
            {!ent.limits.usage_analytics ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Usage analytics are included on the Consultant / Agency plan.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Proposals created", value: analytics?.proposals ?? 0 },
                  { label: "AI drafts generated", value: analytics?.drafts ?? 0 },
                  { label: "Awarded grants", value: analytics?.awarded ?? 0 },
                ].map((k) => (
                  <div key={k.label} className="rounded-xl border border-border p-4">
                    <p className="text-2xl font-bold text-foreground">{k.value}</p>
                    <p className="text-sm text-muted-foreground">{k.label}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </SubscriptionGate>
    </AppShell>
  );
}
