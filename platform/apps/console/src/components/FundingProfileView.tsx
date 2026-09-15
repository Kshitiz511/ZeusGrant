import { useEffect, useState } from "react";
import { Check, Loader2, Save, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useEligibilityCodes, useOrgProfile, useSaveProfile } from "@/lib/hooks";
import type { OrgProfile, OrgProfileInput } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The funding profile every match is scored against.
 *
 * `is_scoreable` comes from the server. Whether a profile has enough in it to
 * run a scan is a scoring rule, and duplicating it here would let the button
 * and the scorer disagree the first time either changed.
 */
export function FundingProfileView({ onNavigate }: { onNavigate: (key: string) => void }) {
  const { data: profile, isLoading, error } = useOrgProfile();
  const { data: codes } = useEligibilityCodes();
  const save = useSaveProfile();
  const [form, setForm] = useState<OrgProfileInput>({});

  // Seed the form once the profile arrives. Keyed on tenant so switching
  // workspaces does not leave another org's answers in the fields.
  useEffect(() => {
    if (profile) setForm(toForm(profile));
  }, [profile]);

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  }

  const set = <K extends keyof OrgProfileInput>(key: K, value: OrgProfileInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleCode = (code: string) => {
    const current = form.eligibility_codes ?? [];
    set(
      "eligibility_codes",
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(form);
  };

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm",
          profile?.is_scoreable
            ? "border-primary/40 bg-primary/5"
            : "border-yellow-500/40 bg-yellow-500/10",
        )}
      >
        {profile?.is_scoreable ? (
          <>
            <Check className="size-4 text-primary" />
            <span>Your profile is complete enough to score against.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => onNavigate("/matches")}
            >
              <Sparkles className="mr-2 size-4" /> Go to matches
            </Button>
          </>
        ) : (
          <span>
            Add your applicant type, home state and at least one focus area. Those four fields are
            what the scorer needs before it can rank anything for you.
          </span>
        )}
      </div>

      <Section title="Organization" hint="Used to check eligibility on each notice.">
        <Field label="Legal name">
          <Input
            value={form.legal_name ?? ""}
            onChange={(e) => set("legal_name", e.target.value)}
            placeholder="Riverside Community Trust"
          />
        </Field>
        <Field label="EIN">
          <Input
            value={form.ein ?? ""}
            onChange={(e) => set("ein", e.target.value)}
            placeholder="12-3456789"
          />
        </Field>
        <Field label="Applicant type">
          <Input
            value={form.applicant_class ?? ""}
            onChange={(e) => set("applicant_class", e.target.value)}
            placeholder="Nonprofit 501(c)(3)"
          />
        </Field>
        <Field label="Annual budget (USD)">
          <Input
            type="number"
            min={0}
            value={form.annual_budget ?? ""}
            onChange={(e) => set("annual_budget", numberOrNull(e.target.value))}
            placeholder="750000"
          />
        </Field>
      </Section>

      <Section
        title="Eligibility"
        hint="Notices list who may apply. Pick everything that describes you — more is better."
        full
      >
        <div className="flex flex-wrap gap-2">
          {(codes ?? []).map((c) => {
            const on = (form.eligibility_codes ?? []).includes(c.code);
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => toggleCode(c.code)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
                title={c.applicant_class ?? undefined}
              >
                {c.description}
              </button>
            );
          })}
          {codes && codes.length === 0 && (
            <p className="text-sm text-muted-foreground">No eligibility codes available.</p>
          )}
        </div>
      </Section>

      <Section title="Geography" hint="Where you are based and where you can deliver work.">
        <Field label="Home state">
          <Input
            value={form.home_state ?? ""}
            onChange={(e) => set("home_state", e.target.value.toUpperCase())}
            maxLength={2}
            placeholder="CA"
          />
        </Field>
        <Field label="Operating states" hint="Two-letter codes, comma separated">
          <Input
            value={(form.operating_states ?? []).join(", ")}
            onChange={(e) => set("operating_states", toList(e.target.value).map((s) => s.toUpperCase()))}
            placeholder="CA, NV, OR"
          />
        </Field>
      </Section>

      <Section title="Programs" hint="What you do and who you serve." full>
        <Field label="Mission" full>
          <Textarea
            rows={3}
            value={form.mission ?? ""}
            onChange={(e) => set("mission", e.target.value)}
            placeholder="We provide after-school STEM programs to students in low-income districts."
          />
        </Field>
        <Field label="Focus areas" hint="Comma separated" full>
          <Input
            value={(form.focus_areas ?? []).join(", ")}
            onChange={(e) => set("focus_areas", toList(e.target.value))}
            placeholder="education, youth development, workforce training"
          />
        </Field>
        <Field label="Populations served" hint="Comma separated" full>
          <Input
            value={(form.populations_served ?? []).join(", ")}
            onChange={(e) => set("populations_served", toList(e.target.value))}
            placeholder="K-12 students, rural communities"
          />
        </Field>
      </Section>

      <Section title="Award size" hint="Opportunities outside this range score lower.">
        <Field label="Minimum award (USD)">
          <Input
            type="number"
            min={0}
            value={form.award_min ?? ""}
            onChange={(e) => set("award_min", numberOrNull(e.target.value))}
            placeholder="25000"
          />
        </Field>
        <Field label="Maximum award (USD)">
          <Input
            type="number"
            min={0}
            value={form.award_max ?? ""}
            onChange={(e) => set("award_max", numberOrNull(e.target.value))}
            placeholder="500000"
          />
        </Field>
        <Field label="Cost share" full>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={!!form.can_cost_share}
              onChange={(e) => set("can_cost_share", e.target.checked)}
              className="size-4 accent-[hsl(var(--primary))]"
            />
            We can meet a matching or cost-share requirement
          </label>
        </Field>
      </Section>

      {save.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {(save.error as Error).message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="hero" disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Save className="mr-2 size-4" />
          )}
          Save profile
        </Button>
        {save.isSuccess && !save.isPending && (
          <Badge variant="secondary" className="gap-1">
            <Check className="size-3.5" /> Saved
          </Badge>
        )}
        <p className="text-xs text-muted-foreground">
          Saving does not run a scan. Start one from Matches when you are ready.
        </p>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  full,
  children,
}: {
  title: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-lift">
      <h2 className="font-bold text-foreground">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className={cn("mt-4 grid gap-4", !full && "sm:grid-cols-2")}>{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", full && "sm:col-span-2")}>
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="ml-1.5 font-normal opacity-70">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

/** Drop the server-owned fields so a save never tries to write them back. */
function toForm(p: OrgProfile): OrgProfileInput {
  const { tenant_id: _t, is_scoreable: _s, ...rest } = p;
  return rest;
}

function toList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
