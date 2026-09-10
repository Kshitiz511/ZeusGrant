import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Sparkles, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { rankOpportunities } from "@/lib/matching";


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — ZCS GrantMatch Innovation" },
      {
        name: "description",
        content: "Your grant readiness score, new matches and upcoming deadlines.",
      },
      { property: "og:title", content: "Dashboard — ZCS GrantMatch Innovation" },
      { property: "og:description", content: "Track readiness, matches and deadlines." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

const REQUIRED_FIELDS = [
  "org_name",
  "org_type",
  "mission",
  "city",
  "state",
  "annual_budget",
  "staff_size",
  "funding_needs",
] as const;

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["org-profile"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_profiles")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: opps } = useQuery({
    queryKey: ["opportunities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const matches = rankOpportunities(data ?? null, opps ?? []);
  const strong = matches.filter((m) => m.eligible && m.score >= 60);
  const closing = matches.filter(
    (m) => m.eligible && m.daysLeft !== null && m.daysLeft >= 0 && m.daysLeft <= 45,
  );

  const filled = data
    ? REQUIRED_FIELDS.filter((f) => {
        const v = (data as Record<string, unknown>)[f];
        return v !== null && v !== undefined && v !== "";
      }).length
    : 0;
  const readiness = Math.round((filled / REQUIRED_FIELDS.length) * 100);


  return (
    <AppShell
      title={data?.org_name ? `Welcome, ${data.org_name}` : "Welcome to GrantMatch"}
      description="Your funding workspace. Complete your profile to unlock personalized matches."
    >
      <div className="grid gap-5 md:grid-cols-3">
        <Link to="/profile" className="block">
        <Card className="h-full shadow-soft transition hover:border-primary hover:shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Target className="size-4 text-primary" /> Grant readiness
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-extrabold text-foreground">
              {isLoading ? "—" : `${readiness}%`}
            </p>
            <Progress value={readiness} className="mt-3" />
            <p className="mt-3 text-xs text-muted-foreground">
              {filled} of {REQUIRED_FIELDS.length} profile essentials complete
            </p>
            <p className="mt-2 text-xs font-semibold text-primary">Open your profile →</p>
          </CardContent>
        </Card>
        </Link>

        <Link to="/opportunities" className="block">
        <Card className="h-full shadow-soft transition hover:border-primary hover:shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Sparkles className="size-4 text-primary" /> New matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-extrabold text-foreground">{strong.length}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Strong-fit opportunities you're eligible for.
            </p>
            <p className="mt-2 text-xs font-semibold text-primary">View matches →</p>
          </CardContent>
        </Card>
        </Link>

        <Link to="/tracker" className="block">
        <Card className="h-full shadow-soft transition hover:border-primary hover:shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <CalendarClock className="size-4 text-primary" /> Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-extrabold text-foreground">{closing.length}</p>
            <p className="mt-3 text-xs text-muted-foreground">Eligible deadlines within 45 days.</p>
            <p className="mt-2 text-xs font-semibold text-primary">Open the calendar →</p>
          </CardContent>
        </Card>
        </Link>

      </div>

      <Card className="mt-6 border-primary/20 bg-background shadow-soft">
        <CardContent className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {data?.onboarding_complete ? "Keep your profile current" : "Finish your setup"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The more we know about your organization, the sharper your fit scores.
            </p>
          </div>
          <Button variant="hero" size="lg" asChild>
            <Link to="/onboarding">
              {data?.onboarding_complete ? "Edit profile" : "Continue setup"}
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
