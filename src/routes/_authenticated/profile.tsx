import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Lock, Unlock, Pencil, Globe, FileText, Users, ClipboardList } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProfileIntelligence } from "@/hooks/useProfileIntelligence";
import { useProfileStrength } from "@/hooks/useProfileStrength";
import { computeStrength, readinessMap, TIERS } from "@/lib/profile-strength";
import { WebsiteScanTab } from "@/components/profile/WebsiteScanTab";
import { TeamResumesTab } from "@/components/profile/TeamResumesTab";
import { PastWorkTab } from "@/components/profile/PastWorkTab";
import { IntelligenceTab } from "@/components/profile/IntelligenceTab";
import { ProfileStrengthGauge } from "@/components/profile/ProfileStrengthIndicator";

type Search = { tab?: string | undefined };

export const Route = createFileRoute("/_authenticated/profile")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    tab: typeof search["tab"] === "string" ? search["tab"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Profile Intelligence | GrantMatch" },
      {
        name: "description",
        content:
          "Your organization's intelligence hub: scan your website, upload resumes, capability statements and past proposals, and power every match and proposal from one profile.",
      },
      { property: "og:title", content: "Profile Intelligence | GrantMatch" },
      {
        property: "og:description",
        content:
          "The profile that powers your funding matches, proposals and compliance tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const { userId, loading, org, documents, people, blocks, stats, dataPoints, scrapes, refresh } =
    useProfileIntelligence();
  const { counts, refresh: refreshStrength } = useProfileStrength();

  const input = {
    org,
    dataPoints,
    people,
    documents,
    blocks,
    stats,
    scrapes,
    pastPerformanceCount: counts.pastPerformance,
  };
  const strength = computeStrength(input);
  const readiness = readinessMap(input);
  const tierMeta = TIERS.find((t) => t.tier === strength.tier)!;

  const setTab = (value: string) => void navigate({ to: "/profile", search: { tab: value } });
  const reload = async () => {
    await refresh();
    await refreshStrength();
  };

  const lastScan = scrapes[0]?.scraped_at;
  const sources = [
    {
      key: "website",
      icon: Globe,
      title: "Website",
      detail: lastScan ? `Last scanned ${new Date(lastScan).toLocaleDateString()}` : "Not scanned yet",
      action: scrapes.length ? "Re-scan" : "Scan website",
      tab: "website",
    },
    {
      key: "documents",
      icon: FileText,
      title: "Documents",
      detail: `${documents.length} file${documents.length === 1 ? "" : "s"} processed`,
      action: "Upload more",
      tab: "team",
    },
    {
      key: "team",
      icon: Users,
      title: "Team resumes",
      detail: `${people.length} ${people.length === 1 ? "person" : "people"} in the bank`,
      action: "Add resumes",
      tab: "team",
    },
    {
      key: "past",
      icon: ClipboardList,
      title: "Prior proposals",
      detail: `${blocks.length} content block${blocks.length === 1 ? "" : "s"} analyzed`,
      action: "Upload proposals",
      tab: "past",
    },
  ] as const;

  const panels: { title: string; items: { label: string; value: string | null }[]; tab: string }[] = [
    {
      title: "Organization identity",
      tab: "intelligence",
      items: [
        { label: "Legal name", value: org?.org_name ?? null },
        { label: "Organization type", value: org?.org_type ?? null },
        { label: "EIN / Tax ID", value: org?.ein ?? null },
        { label: "UEI", value: org?.uei ?? null },
        { label: "Year founded", value: org?.year_founded ? String(org.year_founded) : null },
        { label: "Mission", value: org?.mission ?? null },
      ],
    },
    {
      title: "Certifications & designations",
      tab: "team",
      items: [
        { label: "NAICS codes", value: org?.naics_codes?.join(", ") || null },
        { label: "Certifications", value: org?.certifications?.join(", ") || null },
        { label: "Contract vehicles", value: org?.contract_vehicles?.join(", ") || null },
        {
          label: "SAM.gov status",
          value:
            org?.sam_registered === null || org?.sam_registered === undefined
              ? null
              : org.sam_registered
                ? "Registered"
                : "Not registered",
        },
      ],
    },
    {
      title: "Programs & expertise",
      tab: "website",
      items: [
        { label: "Focus areas", value: org?.focus_areas?.join(", ") || null },
        { label: "Core competencies", value: org?.core_competencies?.join(", ") || null },
        { label: "Populations served", value: org?.populations_served?.join(", ") || null },
        { label: "Service area", value: org?.operating_states?.join(", ") || null },
      ],
    },
    {
      title: "Past performance",
      tab: "past",
      items: [
        { label: "Grants on record", value: counts.pastPerformance ? String(counts.pastPerformance) : null },
        {
          label: "Award notices & proposals",
          value:
            String(
              documents.filter((d) =>
                ["prior_proposal", "award_notice", "past_performance"].includes(d.document_type),
              ).length,
            ) || null,
        },
        { label: "Reusable content blocks", value: blocks.length ? String(blocks.length) : null },
      ],
    },
    {
      title: "Team",
      tab: "team",
      items: people.slice(0, 6).map((p) => ({
        label: p.full_name,
        value: [p.title, p.areas_of_expertise?.slice(0, 2).join(", ")].filter(Boolean).join(" · ") || "—",
      })),
    },
    {
      title: "Impact & credentials",
      tab: "past",
      items: stats.slice(0, 6).map((s) => ({ label: s.stat_text, value: s.time_period ?? "—" })),
    },
  ];

  const activity = [
    ...scrapes.slice(0, 2).map((s) => ({
      id: `scrape-${s.id}`,
      when: s.scraped_at,
      text: `Website scan found ${s.total_data_points_extracted} data points`,
    })),
    ...documents.slice(0, 3).map((d) => ({
      id: `doc-${d.id}`,
      when: d.created_at,
      text: `${d.file_name} processed — ${d.extracted_count} fields extracted`,
    })),
    ...people.slice(0, 3).map((p) => ({
      id: `person-${p.id}`,
      when: p.created_at,
      text: `${p.full_name} added to your resume bank`,
    })),
    ...strength.milestones
      .filter((m) => m.unlocked)
      .map((m) => ({ id: `ms-${m.at}`, when: null, text: `${m.at}% reached — ${m.label} unlocked` })),
  ]
    .sort((a, b) => (b.when ?? "").localeCompare(a.when ?? ""))
    .slice(0, 8);

  return (
    <AppShell
      title="Profile Intelligence"
      description="The brain of your workspace — every match, proposal and contract is powered by what lives here."
    >
      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-start justify-between gap-6 pt-6">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-extrabold text-foreground">
                {org?.org_name ?? "Your organization"}
                <Button asChild variant="ghost" size="sm" aria-label="Edit organization details">
                  <Link to="/onboarding">
                    <Pencil className="size-4" />
                  </Link>
                </Button>
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {org?.org_type && <Badge variant="outline">{org.org_type}</Badge>}
                {(org?.city || org?.state) && <span>{[org?.city, org?.state].filter(Boolean).join(", ")}</span>}
                {org?.year_founded && <span>Founded {org.year_founded}</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="text-center">
                <ProfileStrengthGauge score={strength.score} tier={strength.tier} />
                <p className="mt-1 text-xs text-muted-foreground">Completeness</p>
              </div>
              <Stat label="Proposals in progress" value={counts.proposalsInProgress} />
              <Stat label="Active contracts" value={counts.activeContracts} />
              <Stat label="Grants on record" value={counts.pastPerformance} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-foreground">{tierMeta.label}</p>
              <p className="text-sm text-muted-foreground">
                {strength.score < 100
                  ? "Add more detail to unlock better matches"
                  : "Verified complete profile"}
              </p>
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
              {strength.categories.map((c) => (
                <div
                  key={c.key}
                  className={`${c.ratio > 0 ? tierMeta.color : "bg-transparent"} h-full`}
                  style={{ width: `${c.weight * c.ratio}%` }}
                  title={`${c.label}: ${Math.round(c.ratio * 100)}%`}
                />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {strength.milestones.map((m) => (
                <span
                  key={m.at}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${
                    m.unlocked
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-border text-muted-foreground"
                  }`}
                  title={m.blurb}
                >
                  {m.unlocked ? <Unlock className="size-3" /> : <Lock className="size-3" />}
                  {m.at}% {m.label}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {sources.map(({ key, icon: Icon, title, detail, action, tab: target }) => (
            <Card key={key} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-6">
                <Icon className="size-5 text-primary" />
                <p className="mt-2 font-bold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground">{detail}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setTab(target)}>
                  {action}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {panels.map((panel) => (
              <Card key={panel.title}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{panel.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {panel.items.length === 0 && (
                    <p className="text-muted-foreground">Nothing here yet.</p>
                  )}
                  {panel.items.map((item) => (
                    <div key={item.label} className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span
                        className={`max-w-[60%] truncate text-right font-medium ${
                          item.value ? "text-foreground" : "text-rose-600"
                        }`}
                      >
                        {item.value ?? "Missing"}
                      </span>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => setTab(panel.tab)}>
                    Add data
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent profile activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {activity.length === 0 && (
                <p className="text-muted-foreground">
                  Activity will appear here as you enrich your profile.
                </p>
              )}
              {activity.map((a) => (
                <div key={a.id} className="border-l-2 border-primary/40 pl-3">
                  <p className="text-foreground">{a.text}</p>
                  {a.when && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.when).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What your profile unlocks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {readiness.map((row) => (
              <div
                key={row.category}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
              >
                <span className="font-semibold text-foreground">{row.category}</span>
                <span className="flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className={
                      row.status === "ready"
                        ? "border-emerald-300 text-emerald-700"
                        : row.status === "partial"
                          ? "border-amber-300 text-amber-700"
                          : "border-rose-300 text-rose-700"
                    }
                  >
                    {row.status === "ready" ? "Ready" : row.status === "partial" ? "Partial" : "Not ready"}
                  </Badge>
                  <span className="text-muted-foreground">{row.detail}</span>
                  {row.status !== "ready" && row.fixTab && (
                    <Button variant="ghost" size="sm" onClick={() => setTab(row.fixTab!)}>
                      Fix this
                    </Button>
                  )}
                </span>
              </div>
            ))}
            <p className="pt-2 text-sm text-muted-foreground">
              {strength.score >= 40 ? (
                <Link to="/opportunities" className="text-primary hover:underline">
                  See the funding opportunities that match this profile
                </Link>
              ) : (
                "Reach 40% completeness to unlock funding matches."
              )}
            </p>
          </CardContent>
        </Card>

        {loading || !userId ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs value={tab ?? "website"} onValueChange={setTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="website">Website scan</TabsTrigger>
              <TabsTrigger value="team">Team & capability</TabsTrigger>
              <TabsTrigger value="past">Past work & content</TabsTrigger>
              <TabsTrigger value="intelligence">All profile facts</TabsTrigger>
            </TabsList>

            <TabsContent value="website" className="mt-6">
              <WebsiteScanTab userId={userId} org={org} scrapes={scrapes} onChange={reload} />
            </TabsContent>
            <TabsContent value="team" className="mt-6">
              <TeamResumesTab
                userId={userId}
                people={people}
                documents={documents}
                org={org}
                onChange={reload}
              />
            </TabsContent>
            <TabsContent value="past" className="mt-6">
              <PastWorkTab
                userId={userId}
                documents={documents}
                blocks={blocks}
                stats={stats}
                onChange={reload}
              />
            </TabsContent>
            <TabsContent value="intelligence" className="mt-6">
              <IntelligenceTab userId={userId} dataPoints={dataPoints} onChange={reload} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-extrabold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
