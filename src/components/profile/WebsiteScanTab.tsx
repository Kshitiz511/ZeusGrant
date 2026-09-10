import { useState } from "react";
import { Globe, Loader2, RefreshCcw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { scrapeWebsite } from "@/utils/profile.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { normalizeConfidence, type ScrapedProfile } from "@/lib/profile-intelligence";
import type { OrgProfile, ScrapeSession } from "@/hooks/useProfileIntelligence";

type Draft = {
  category: string;
  field_name: string;
  field_value: string;
  confidence: string;
  source_page: string;
  keep: boolean;
};

function toDrafts(profile: ScrapedProfile, siteUrl: string): Draft[] {
  const rows: Draft[] = [];
  const push = (
    category: string,
    field_name: string,
    value: unknown,
    source_page = siteUrl,
    confidence = "medium",
  ) => {
    if (value === null || value === undefined || value === "") return;
    const field_value = Array.isArray(value)
      ? value
          .map((v) => (typeof v === "object" ? Object.values(v as object).filter(Boolean).join(" — ") : String(v)))
          .filter(Boolean)
          .join("; ")
      : String(value);
    if (!field_value.trim()) return;
    rows.push({ category, field_name, field_value, confidence, source_page, keep: true });
  };

  push("identity", "Legal name", profile.org_name, siteUrl, "high");
  push("identity", "DBA / brand name", profile.dba_name);
  push("identity", "Organization type", profile.org_type);
  push("identity", "Mission statement", profile.mission, siteUrl, "high");
  push("identity", "Vision statement", profile.vision);
  push("identity", "Year founded", profile.year_founded);
  push("identity", "Primary address", profile.address);
  push("identity", "Phone", profile.phone);
  push("identity", "Email", profile.email);
  push("identity", "Social links", profile.social_links);
  push("programs", "Programs & services", profile.programs);
  push("programs", "Focus areas", profile.focus_areas);
  push("population", "Populations served", profile.populations_served);
  push("geography", "Service area", profile.service_area);
  push("geography", "Geographic reach", profile.geographic_reach);
  push("capacity", "Staff count", profile.staff_count);
  push("capacity", "Volunteers", profile.volunteer_count);
  push("capacity", "Leadership", profile.leadership);
  push("capacity", "Board members", profile.board_members);
  push("capacity", "Partners", profile.partners);
  push("certifications", "Accreditations", profile.accreditations);
  push("capacity", "Awards & recognition", profile.awards);
  push("financial", "Annual budget", profile.annual_budget);
  push("financial", "Funding sources", profile.funding_sources);
  push("past_performance", "Grants & contracts mentioned", profile.grant_awards);
  push("past_performance", "Case studies", profile.case_studies);
  push("past_performance", "Media mentions", profile.media_mentions);
  push("past_performance", "Testimonials", profile.testimonials);

  for (const dp of profile.data_points ?? []) {
    if (!dp?.field_name || !dp?.field_value) continue;
    if (rows.some((r) => r.field_name.toLowerCase() === dp.field_name.toLowerCase())) continue;
    rows.push({
      category: dp.category || "identity",
      field_name: dp.field_name,
      field_value: dp.field_value,
      confidence: normalizeConfidence(dp.confidence),
      source_page: dp.source_page || siteUrl,
      keep: true,
    });
  }
  return rows;
}

export function WebsiteScanTab({
  userId,
  org,
  scrapes,
  onChange,
}: {
  userId: string;
  org: OrgProfile | null;
  scrapes: ScrapeSession[];
  onChange: () => Promise<void> | void;
}) {
  const scrape = useServerFn(scrapeWebsite);
  const [url, setUrl] = useState(org?.website ?? "");
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [profile, setProfile] = useState<ScrapedProfile | null>(null);

  const lastScrape = scrapes[0];
  const knownFields = new Set<string>();

  async function run() {
    if (!url.trim()) {
      toast.error("Enter your website address first.");
      return;
    }
    setBusy(true);
    try {
      const result = await scrape({ data: { url: url.trim() } });
      setPages(result.pages);
      setProfile(result.profile);
      setDrafts(toDrafts(result.profile, result.pages[0] ?? url));
      toast.success(`We read ${result.pages.length} pages from your site.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The scan failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!drafts) return;
    const keep = drafts.filter((d) => d.keep && d.field_value.trim());
    setBusy(true);
    try {
      const { data: session, error: sessionError } = await supabase
        .from("website_scrape_sessions")
        .insert({
          user_id: userId,
          website_url: url.trim(),
          pages_scraped: pages,
          total_data_points_extracted: keep.length,
          status: "complete",
          raw_extraction: (profile ?? {}) as never,
          reviewed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (sessionError) throw new Error(sessionError.message);

      if (keep.length) {
        const { error } = await supabase.from("org_profile_data_points").insert(
          keep.map((d) => ({
            user_id: userId,
            category: d.category,
            field_name: d.field_name,
            field_value: d.field_value,
            source_type: "website",
            source_scrape_session_id: session.id,
            source_label: d.source_page,
            confidence: normalizeConfidence(d.confidence),
          })),
        );
        if (error) throw new Error(error.message);
      }

      for (const stat of profile?.impact_statistics ?? []) {
        if (!stat?.stat_text) continue;
        await supabase.from("impact_statistics").insert({
          user_id: userId,
          stat_text: stat.stat_text,
          numeric_value: stat.numeric_value,
          unit: stat.unit,
          time_period: stat.time_period,
        });
      }

      await supabase
        .from("org_profiles")
        .update({ website: url.trim(), last_scraped_at: new Date().toISOString() })
        .eq("user_id", userId);

      toast.success(`Saved ${keep.length} data points to your profile.`);
      setDrafts(null);
      setPages([]);
      await onChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the scan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4 text-primary" /> Your organization&apos;s website
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="website-url">Website address</Label>
            <Input
              id="website-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourorganization.org"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={run} disabled={busy}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Globe className="mr-2 size-4" />}
              {lastScrape ? "Re-scan website" : "Auto-fill profile from website"}
            </Button>
            {lastScrape && (
              <p className="text-xs text-muted-foreground">
                Last scanned {new Date(lastScrape.scraped_at).toLocaleString()} ·{" "}
                {lastScrape.pages_scraped.length} pages · {lastScrape.total_data_points_extracted} data points
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            We read up to 10 pages of your site (home, about, programs, team, contact) and never follow
            links to other domains. Nothing is saved to your profile until you confirm it below.
          </p>
        </CardContent>
      </Card>

      {drafts && (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-sm">Pages we read</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm font-semibold text-foreground">
                {pages.length} pages · {drafts.length} data points
              </p>
              <ul className="space-y-1">
                {pages.map((p) => (
                  <li key={p}>
                    <a
                      href={p}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-primary hover:underline"
                    >
                      {p}
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Review what we found</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDrafts(null)} disabled={busy}>
                  Discard
                </Button>
                <Button size="sm" onClick={save} disabled={busy}>
                  {busy && <Loader2 className="mr-2 size-4 animate-spin" />}Save to profile
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {drafts.map((d, index) => {
                const duplicate = knownFields.has(d.field_name);
                knownFields.add(d.field_name);
                return (
                  <div
                    key={`${d.field_name}-${index}`}
                    className={`rounded-lg border border-border p-3 ${d.keep ? "" : "opacity-50"}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{d.field_name}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          From: {new URL(d.source_page).pathname || "/"}
                        </Badge>
                        {normalizeConfidence(d.confidence) === "low" && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                            <TriangleAlert className="size-3" /> Please confirm this
                          </span>
                        )}
                        {duplicate && (
                          <Badge variant="outline" className="text-[10px]">
                            Duplicate
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDrafts((rows) =>
                            rows!.map((r, i) => (i === index ? { ...r, keep: !r.keep } : r)),
                          )
                        }
                      >
                        {d.keep ? <Trash2 className="size-4" /> : <RefreshCcw className="size-4" />}
                      </Button>
                    </div>
                    <Input
                      className="mt-2"
                      value={d.field_value}
                      onChange={(e) =>
                        setDrafts((rows) =>
                          rows!.map((r, i) => (i === index ? { ...r, field_value: e.target.value } : r)),
                        )
                      }
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
