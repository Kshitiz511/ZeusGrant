import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, HelpCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  SERVICE_AREA_SCOPES,
  SCOPE_PREFERENCES,
  YES_NO_MAYBE,
  RELOCATION_OPTIONS,
} from "@/lib/geography";


export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Organization profile — ZCS GrantMatch Innovation" },
      {
        name: "description",
        content: "Tell us about your organization so we can match you to the right funding.",
      },
      { property: "og:title", content: "Organization profile — ZCS GrantMatch Innovation" },
      { property: "og:description", content: "Build the profile that powers your grant matches." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OnboardingPage,
});

type Form = {
  org_name: string;
  org_type: string;
  mission: string;
  ein: string;
  year_founded: string;
  website: string;
  city: string;
  state: string;
  country: string;
  operating_states: string;
  counties_served: string;
  service_area_scope: string;
  target_expansion_markets: string;
  project_location_flexibility: string;
  relocation_willingness: string;
  geographic_scope_preference: string;

  annual_budget: string;
  staff_size: string;
  focus_areas: string;
  populations_served: string;
  funding_needs: string;
  funding_amount_min: string;
  funding_amount_max: string;
  readiness_notes: string;
};

const EMPTY: Form = {
  org_name: "",
  org_type: "",
  mission: "",
  ein: "",
  year_founded: "",
  website: "",
  city: "",
  state: "",
  country: "United States",
  operating_states: "",
  counties_served: "",
  service_area_scope: "Local",
  target_expansion_markets: "",
  project_location_flexibility: "Depends on the opportunity",
  relocation_willingness: "No",
  geographic_scope_preference: "Anywhere I am eligible",

  annual_budget: "",
  staff_size: "",
  focus_areas: "",
  populations_served: "",
  funding_needs: "",
  funding_amount_min: "",
  funding_amount_max: "",
  readiness_notes: "",
};

const STEPS = [
  "Organization",
  "Mission",
  "Registration",
  "Location",
  "Capacity",
  "Focus areas",
  "Funding needs",
  "Readiness",
];

function Help({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="More information" className="text-muted-foreground">
            <HelpCircle className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        <Help text={help} />
      </div>
      {children}
    </div>
  );
}

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["org-profile"],
    queryFn: async () => {
      const { data, error } = await supabase.from("org_profiles").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      org_name: data.org_name ?? "",
      org_type: data.org_type ?? "",
      mission: data.mission ?? "",
      ein: data.ein ?? "",
      year_founded: data.year_founded?.toString() ?? "",
      website: data.website ?? "",
      city: data.city ?? "",
      state: data.state ?? "",
      country: data.country ?? "United States",
      operating_states: (data.operating_states ?? []).join(", "),
      counties_served: (data.counties_served ?? []).join(", "),
      service_area_scope: data.service_area_scope ?? "Local",
      target_expansion_markets: (data.target_expansion_markets ?? []).join(", "),
      project_location_flexibility:
        data.project_location_flexibility ?? "Depends on the opportunity",
      relocation_willingness: data.relocation_willingness ?? "No",
      geographic_scope_preference: data.geographic_scope_preference ?? "Anywhere I am eligible",

      annual_budget: data.annual_budget?.toString() ?? "",
      staff_size: data.staff_size?.toString() ?? "",
      focus_areas: (data.focus_areas ?? []).join(", "),
      populations_served: (data.populations_served ?? []).join(", "),
      funding_needs: data.funding_needs ?? "",
      funding_amount_min: data.funding_amount_min?.toString() ?? "",
      funding_amount_max: data.funding_amount_max?.toString() ?? "",
      readiness_notes: data.readiness_notes ?? "",
    });
    setStep(Math.min(Math.max(data.onboarding_step ?? 1, 1), STEPS.length));
  }, [data]);

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save(nextStep: number, complete = false) {
    if (!data?.id) return;
    setSaving(true);
    try {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      const list = (v: string) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      const { error } = await supabase
        .from("org_profiles")
        .update({
          org_name: form.org_name,
          org_type: form.org_type || null,
          mission: form.mission || null,
          ein: form.ein || null,
          year_founded: num(form.year_founded),
          website: form.website || null,
          city: form.city || null,
          state: form.state || null,
          country: form.country || null,
          operating_states: list(form.operating_states),
          counties_served: list(form.counties_served),
          service_area_scope: form.service_area_scope || null,
          target_expansion_markets: list(form.target_expansion_markets),
          project_location_flexibility: form.project_location_flexibility || null,
          relocation_willingness: form.relocation_willingness || null,
          geographic_scope_preference:
            form.geographic_scope_preference || "Anywhere I am eligible",


          annual_budget: num(form.annual_budget),
          staff_size: num(form.staff_size),
          focus_areas: list(form.focus_areas),
          populations_served: list(form.populations_served),
          funding_needs: form.funding_needs || null,
          funding_amount_min: num(form.funding_amount_min),
          funding_amount_max: num(form.funding_amount_max),
          readiness_notes: form.readiness_notes || null,
          onboarding_step: nextStep,
          onboarding_complete: complete || data.onboarding_complete,
        })
        .eq("id", data.id);
      if (error) throw error;
      if (complete) {
        toast.success("Profile saved. We'll start matching you to funding.");
        void navigate({ to: "/dashboard" });
      } else {
        setStep(nextStep);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <AppShell title="Organization profile">
        <Loader2 className="size-6 animate-spin text-primary" />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Organization profile"
      description={`Step ${step} of ${STEPS.length} — ${STEPS[step - 1]}`}
    >
      <Progress value={(step / STEPS.length) * 100} className="mb-6" />

      <Card className="shadow-soft">
        <CardContent className="space-y-5 p-6">
          {step === 1 && (
            <>
              <Field label="Organization name" help="The legal name funders will see on applications.">
                <Input value={form.org_name} onChange={(e) => set("org_name")(e.target.value)} />
              </Field>
              <Field
                label="Organization type"
                help="e.g. 501(c)(3) nonprofit, small business, school district, tribal entity, individual."
              >
                <Input value={form.org_type} onChange={(e) => set("org_type")(e.target.value)} />
              </Field>
              <Field label="Website" help="Funders often check your online presence for credibility.">
                <Input value={form.website} onChange={(e) => set("website")(e.target.value)} />
              </Field>
            </>
          )}

          {step === 2 && (
            <Field
              label="Mission and programs"
              help="Describe what you do and who benefits. This text drives your fit scoring."
            >
              <Textarea
                rows={7}
                value={form.mission}
                onChange={(e) => set("mission")(e.target.value)}
              />
            </Field>
          )}

          {step === 3 && (
            <>
              <Field label="EIN / registration number" help="Most federal grants require a registered entity ID.">
                <Input value={form.ein} onChange={(e) => set("ein")(e.target.value)} />
              </Field>
              <Field label="Year founded" help="Some funders require a minimum operating history.">
                <Input
                  inputMode="numeric"
                  value={form.year_founded}
                  onChange={(e) => set("year_founded")(e.target.value)}
                />
              </Field>
            </>
          )}

          {step === 4 && (
            <>
              <Field label="City" help="Many grants are geographically restricted.">
                <Input value={form.city} onChange={(e) => set("city")(e.target.value)} />
              </Field>
              <Field label="State / region" help="Used to match state and regional funding programs.">
                <Input value={form.state} onChange={(e) => set("state")(e.target.value)} />
              </Field>
              <Field label="Country" help="Determines which national funding sources apply.">
                <Input value={form.country} onChange={(e) => set("country")(e.target.value)} />
              </Field>
              <Field
                label="States you operate in"
                help="Comma separated two-letter codes, e.g. TX, NM. Unlocks state funding beyond your headquarters."
              >
                <Input
                  value={form.operating_states}
                  onChange={(e) => set("operating_states")(e.target.value)}
                />
              </Field>
              <Field
                label="Counties served"
                help="Comma separated. County and municipal funders restrict eligibility to specific counties."
              >
                <Input
                  value={form.counties_served}
                  onChange={(e) => set("counties_served")(e.target.value)}
                />
              </Field>
              <Field
                label="Service area scope"
                help="How wide is the area your programs actually serve?"
              >
                <select
                  value={form.service_area_scope}
                  onChange={(e) => set("service_area_scope")(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {SERVICE_AREA_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Target expansion markets"
                help="Comma separated states or cities you would expand into for the right funding."
              >
                <Input
                  value={form.target_expansion_markets}
                  onChange={(e) => set("target_expansion_markets")(e.target.value)}
                />
              </Field>
              <Field
                label="Can your project be located anywhere?"
                help="Some funders require the funded project to sit inside their jurisdiction."
              >
                <select
                  value={form.project_location_flexibility}
                  onChange={(e) => set("project_location_flexibility")(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {YES_NO_MAYBE.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Willing to relocate or open a new site?"
                help="If yes, we surface place-based funding in your expansion markets."
              >
                <select
                  value={form.relocation_willingness}
                  onChange={(e) => set("relocation_willingness")(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {RELOCATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Geographic search scope"
                help="Controls how far outside your home area we look for funding."
              >
                <select
                  value={form.geographic_scope_preference}
                  onChange={(e) => set("geographic_scope_preference")(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {SCOPE_PREFERENCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>

            </>
          )}

          {step === 5 && (
            <>
              <Field label="Annual budget (USD)" help="Funders use budget size to gauge capacity and award fit.">
                <Input
                  inputMode="numeric"
                  value={form.annual_budget}
                  onChange={(e) => set("annual_budget")(e.target.value)}
                />
              </Field>
              <Field label="Staff size" help="Include full-time equivalents; volunteers can go in readiness notes.">
                <Input
                  inputMode="numeric"
                  value={form.staff_size}
                  onChange={(e) => set("staff_size")(e.target.value)}
                />
              </Field>
            </>
          )}

          {step === 6 && (
            <>
              <Field
                label="Focus areas"
                help="Comma separated, e.g. education, workforce development, health equity."
              >
                <Input
                  value={form.focus_areas}
                  onChange={(e) => set("focus_areas")(e.target.value)}
                />
              </Field>
              <Field
                label="Populations served"
                help="Comma separated, e.g. youth, veterans, rural communities."
              >
                <Input
                  value={form.populations_served}
                  onChange={(e) => set("populations_served")(e.target.value)}
                />
              </Field>
            </>
          )}

          {step === 7 && (
            <>
              <Field label="What do you need funding for?" help="Projects, equipment, staffing, capacity building.">
                <Textarea
                  rows={5}
                  value={form.funding_needs}
                  onChange={(e) => set("funding_needs")(e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Minimum award (USD)" help="Smallest award worth your application effort.">
                  <Input
                    inputMode="numeric"
                    value={form.funding_amount_min}
                    onChange={(e) => set("funding_amount_min")(e.target.value)}
                  />
                </Field>
                <Field label="Maximum award (USD)" help="Largest award your organization could responsibly manage.">
                  <Input
                    inputMode="numeric"
                    value={form.funding_amount_max}
                    onChange={(e) => set("funding_amount_max")(e.target.value)}
                  />
                </Field>
              </div>
            </>
          )}

          {step === 8 && (
            <Field
              label="Readiness notes"
              help="Audited financials, past awards, policies, fiscal sponsor, board structure — anything reviewers ask for."
            >
              <Textarea
                rows={7}
                value={form.readiness_notes}
                onChange={(e) => set("readiness_notes")(e.target.value)}
              />
            </Field>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="ghost"
              disabled={step === 1 || saving}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
            >
              <ArrowLeft className="mr-2 size-4" /> Back
            </Button>
            {step < STEPS.length ? (
              <Button type="button" variant="hero" disabled={saving} onClick={() => save(step + 1)}>
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Save and continue
                <ArrowRight className="ml-2 size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="hero"
                disabled={saving}
                onClick={() => save(STEPS.length, true)}
              >
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Finish setup
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
