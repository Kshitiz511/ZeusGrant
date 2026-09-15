import { useState } from "react";
import {
  ArrowRight,
  Database,
  KeyRound,
  ListChecks,
  Lock,
  Radar,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import { Hero } from "@/components/site/Hero";
import { Reveal, Section, SectionHeading } from "@/components/site/Primitives";
import { SiteNav } from "@/components/site/SiteNav";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { LIVE_MODULES, MODULES, money, type ModuleId } from "@/lib/modules";
import { cn } from "@/lib/utils";

/**
 * Public marketing page.
 *
 * Copy discipline: nothing here claims a customer, a logo, a testimonial or a
 * metric we cannot substantiate. The product is pre-launch, and invented social
 * proof is both dishonest and trivially disproved by a visitor who asks one
 * question. What it does claim -- extraction, citation, isolation -- is
 * implemented and tested.
 */
export function LandingPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <div className="min-h-dvh bg-background">
      <SiteNav onNavigate={onNavigate} />
      <main>
        <Hero onNavigate={onNavigate} />
        <ProblemSection />
        <HowItWorksSection />
        <PlatformSection onNavigate={onNavigate} />
        <SecuritySection />
        <PricingSection onNavigate={onNavigate} />
        <CtaSection onNavigate={onNavigate} />
      </main>
      <SiteFooter onNavigate={onNavigate} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const PAINS = [
  {
    icon: Search,
    title: "The right grant is buried in the wrong ones",
    body: "There are tens of thousands of open federal opportunities. Keyword search returns the ones that mention your words, not the ones you are eligible for, so the shortlist is built by hand and built badly.",
  },
  {
    icon: ScrollText,
    title: "The obligations are buried too",
    body: "A single award agreement can carry dozens of commitments, scattered across sections and written in language designed for lawyers rather than for the person who has to deliver on them.",
  },
  {
    icon: Database,
    title: "The deadline arrives before the reminder",
    body: "Nothing is watching the calendar — not the submission date you meant to hit, and not the report you owe six months after the award. Both are discovered late, and late is the expensive part.",
  },
];

function ProblemSection() {
  return (
    <Section className="border-y border-border/60 bg-muted/30">
      <SectionHeading
        eyebrow="The problem"
        title="Funding is lost at both ends."
        description="Organisations miss opportunities they were eligible for, and miss obligations they agreed to. Neither is a decision. Both are things nobody could see in time."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {PAINS.map((p, i) => (
          <Reveal key={p.title} delay={i * 110}>
            <article className="lift-on-hover h-full rounded-2xl border border-border/70 bg-background p-7">
              <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/8 text-primary">
                <p.icon className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-bold text-ink">{p.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

const STEPS = [
  {
    icon: Radar,
    step: "01",
    title: "Describe your organisation once",
    body: "Eligibility type, where you operate, what you fund, the award sizes you can absorb. This is the profile every opportunity is scored against.",
    service: "Grant Intelligence",
  },
  {
    icon: Target,
    step: "02",
    title: "Get matches with the reasoning attached",
    body: "Every open opportunity is scored against that profile. Each score is shown with what produced it, so you can dismiss a bad match in seconds instead of reading the notice to find out.",
    service: "Grant Intelligence",
  },
  {
    icon: Upload,
    step: "03",
    title: "Upload the agreement you win",
    body: "Drop in the PDF or Word document. Zeus handles long agreements by reading them in sections, so page count is not a limit.",
    service: "Contract Compliance",
  },
  {
    icon: ListChecks,
    step: "04",
    title: "Work the obligations it contains",
    body: "Each commitment comes back structured — what is owed, by whom, by when — carrying the exact clause it came from. Edit anything the model got wrong; your edits survive re-analysis.",
    service: "Contract Compliance",
  },
];

function HowItWorksSection() {
  return (
    <Section id="how">
      <SectionHeading
        eyebrow="How it works"
        title="From open opportunity to delivered obligation"
        description="The two services join up if you buy both, and each one stands on its own if you don't."
      />
      <div className="relative mt-14">
        {/* Connecting rule behind the cards. Decorative, so it sits behind and
            is hidden where the cards stack vertically. */}
        <div
          aria-hidden
          className="absolute left-0 right-0 top-[4.25rem] hidden h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent lg:block"
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.step} delay={i * 130}>
              <article className="lift-on-hover glass relative h-full rounded-2xl p-7">
                <div className="flex items-center justify-between">
                  <span className="inline-flex size-12 items-center justify-center rounded-xl bg-brand-gradient text-primary-foreground shadow-soft">
                    <s.icon className="size-5" />
                  </span>
                  <span className="text-3xl font-extrabold text-primary/12">{s.step}</span>
                </div>
                <p className="mt-5 text-[11px] font-bold uppercase tracking-wider text-primary/70">
                  {s.service}
                </p>
                <h3 className="mt-1.5 text-lg font-bold text-ink">{s.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function PlatformSection({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <Section id="platform" className="border-y border-border/60 bg-muted/30">
      <SectionHeading
        eyebrow="The platform"
        title="Separate services. One account."
        description="Each service is licensed on its own — buy one, buy both, cancel either. They share the same workspace, the same team and the same security model, so running two costs you one login rather than two tools."
      />
      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {MODULES.map((m, i) => {
          const live = m.status === "available";
          return (
            <Reveal key={m.id} delay={i * 120}>
              <article
                className={cn(
                  "lift-on-hover flex h-full flex-col rounded-2xl border bg-background p-7",
                  live ? "border-primary/25 shadow-soft" : "border-border/70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      "inline-flex size-11 items-center justify-center rounded-xl",
                      live
                        ? "bg-brand-gradient text-primary-foreground shadow-soft"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <m.icon className="size-5" />
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider",
                      live ? "bg-success/12 text-success" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {live ? "Available now" : "Coming soon"}
                  </span>
                </div>

                <h3 className="mt-5 text-lg font-bold text-ink">{m.name}</h3>
                <p className="mt-1 text-sm font-medium text-primary">{m.tagline}</p>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{m.summary}</p>

                <ul className="mt-5 space-y-2.5 border-t border-border/60 pt-5">
                  {m.points.map((p) => (
                    <li key={p} className="flex items-center gap-2.5 text-sm text-foreground">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          live ? "bg-accent" : "bg-muted-foreground/40",
                        )}
                      />
                      {p}
                    </li>
                  ))}
                </ul>

                {/* Pinned to the bottom so the three cards agree on where the
                    price sits, whatever the copy length above it. */}
                <div className="mt-auto border-t border-border/60 pt-5">
                  {live ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        From{" "}
                        <span className="text-base font-extrabold text-ink">
                          {money(m.startingPrice)}
                        </span>
                        /month
                      </p>
                      <Button
                        variant="outline"
                        className="mt-3 w-full"
                        onClick={() => onNavigate("/signup")}
                      >
                        Start free
                        <ArrowRight className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Not built yet. It is on the roadmap, not on sale.
                    </p>
                  )}
                </div>
              </article>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

const SECURITY = [
  {
    icon: Lock,
    title: "Isolation enforced by the database",
    body: "Every tenant's data is separated by row-level security in Postgres, not by a filter in application code. A bug in a query cannot leak another organization's records, because the database refuses to return them.",
  },
  {
    icon: KeyRound,
    title: "Sessions that cannot be stolen from the page",
    body: "Access tokens live in memory only, never in browser storage. Refresh tokens sit in cookies that scripts cannot read, rotate on every use, and revoke the entire session family if an old one is ever replayed.",
  },
  {
    icon: ScrollText,
    title: "An audit trail you cannot edit",
    body: "Every action is written to an append-only log. The application has permission to add records and no permission to change or delete them.",
  },
  {
    icon: ShieldCheck,
    title: "Documents treated as untrusted",
    body: "Uploaded contracts are handled as data, never as instructions. A document that tries to talk to the model is fenced off and its attempts are discarded.",
  },
];

function SecuritySection() {
  return (
    <Section id="security">
      <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <SectionHeading
          align="left"
          eyebrow="Security"
          title="Built for data someone else is accountable for"
          description="You are handling funder agreements and your organisation's funding position. The guarantees below are structural — they hold because of how the system is built, not because of how carefully it is used."
          className="max-w-none lg:sticky lg:top-28"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {SECURITY.map((s, i) => (
            <Reveal key={s.title} delay={i * 100}>
              <article className="lift-on-hover h-full rounded-2xl border border-border/70 bg-background p-6">
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
                  <s.icon className="size-4.5" />
                </span>
                <h3 className="mt-4 text-base font-bold text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Public price list.
 *
 * These mirror `platform.plans` and are asserted against the database by
 * `scripts/check_public_pricing.py`, so the marketing page cannot quietly
 * drift from what Stripe will actually charge. Update both together.
 *
 * Limits are the ones the plan actually enforces — `matches_per_month` for
 * Grant Intelligence, `contracts_max` for Contract Compliance — rather than
 * invented feature bullets.
 */
const PRICING: Record<
  string,
  { plan: string; name: string; price: number; tagline: string; features: string[]; featured: boolean }[]
> = {
  grant_intelligence: [
    {
      plan: "gi_starter",
      name: "Starter",
      price: 49,
      tagline: "For one person doing the searching.",
      features: ["25 scored matches / month", "1 seat", "Full scoring breakdown", "Eligibility screening"],
      featured: false,
    },
    {
      plan: "gi_growth",
      name: "Growth",
      price: 99,
      tagline: "For a team chasing several deadlines.",
      features: ["100 scored matches / month", "3 seats", "Saved & dismissed tracking", "Priority support"],
      featured: true,
    },
    {
      plan: "gi_professional",
      name: "Professional",
      price: 199,
      tagline: "For organisations applying continuously.",
      features: ["Unlimited matches", "10 seats", "Everything in Growth"],
      featured: false,
    },
  ],
  contract_compliance: [
    {
      plan: "cc_starter",
      name: "Starter",
      price: 39,
      tagline: "For a first funded contract.",
      features: ["1 contract", "1 seat", "AI obligation extraction", "Clause-level citations"],
      featured: false,
    },
    {
      plan: "cc_growth",
      name: "Growth",
      price: 79,
      tagline: "For teams running several awards.",
      features: ["5 contracts", "3 seats", "Task queue with owners", "Activity history"],
      featured: true,
    },
    {
      plan: "cc_professional",
      name: "Professional",
      price: 149,
      tagline: "For a full compliance function.",
      features: ["15 contracts", "10 seats", "Everything in Growth"],
      featured: false,
    },
  ],
};

function PricingSection({ onNavigate }: { onNavigate: (to: string) => void }) {
  // Only live services appear. Listing a price for something we have not built
  // would be taking money for a roadmap.
  const [service, setService] = useState<ModuleId>(LIVE_MODULES[0].id);
  const tiers = PRICING[service] ?? [];
  const meta = LIVE_MODULES.find((m) => m.id === service)!;

  return (
    <Section id="pricing" className="border-y border-border/60 bg-muted/30">
      <SectionHeading
        eyebrow="Pricing"
        title="Priced per service, billed monthly"
        description="Each service is bought separately, so you are never paying for the half you do not use. Start on a free trial and add a card when you are ready — not before."
      />

      {/* Service switch. Two services means two price lists, and stacking six
          cards would bury the difference between them. */}
      <Reveal className="mx-auto mt-10 max-w-md">
        <div className="flex rounded-xl border border-border/70 bg-background p-1">
          {LIVE_MODULES.map((m) => (
            <button
              key={m.id}
              onClick={() => setService(m.id)}
              className={cn(
                "flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors duration-200",
                service === m.id
                  ? "bg-brand-gradient text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-ink",
              )}
            >
              {m.name}
            </button>
          ))}
        </div>
      </Reveal>

      <p className="mx-auto mt-4 max-w-md text-center text-sm text-muted-foreground">
        {meta.tagline}
      </p>

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {tiers.map((t, i) => (
          <Reveal key={`${service}-${t.plan}`} delay={i * 110}>
            <article
              className={cn(
                "lift-on-hover flex h-full flex-col rounded-2xl p-7",
                t.featured
                  ? "glass-strong border-primary/30 ring-1 ring-primary/15"
                  : "border border-border/70 bg-background",
              )}
            >
              {t.featured && (
                <span className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-gradient px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
                  <Sparkles className="size-3" />
                  Most chosen
                </span>
              )}
              <h3 className="text-lg font-bold text-ink">{t.name}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{t.tagline}</p>
              <div className="mt-6 flex items-baseline gap-1.5">
                <span className="text-4xl font-extrabold tracking-tight text-ink">
                  {money(t.price)}
                </span>
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3 border-t border-border/60 pt-6">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-foreground">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={t.featured ? "hero" : "outline"}
                size="lg"
                className={cn("mt-7 w-full", t.featured && "sheen-on-hover")}
                onClick={() => onNavigate("/signup")}
              >
                Start free
              </Button>
            </article>
          </Reveal>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Larger team, or a security review to get through?{" "}
        <a
          href="https://zeusconsultingservices.com"
          className="font-semibold text-primary hover:underline"
        >
          Talk to us about Agency and Enterprise
        </a>
        .
      </p>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function CtaSection({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <Section>
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-[2rem] bg-brand-gradient px-8 py-16 text-center sm:px-14 md:py-20">
          {/* Grid inside the panel, masked to fade at the edges. */}
          <div
            aria-hidden
            className="bg-grid pointer-events-none absolute inset-0 opacity-[0.18]"
            style={{
              maskImage: "radial-gradient(70% 60% at 50% 50%, black, transparent 100%)",
              WebkitMaskImage: "radial-gradient(70% 60% at 50% 50%, black, transparent 100%)",
            }}
          />
          <div className="relative">
            <h2 className="text-balance text-3xl font-extrabold leading-tight text-primary-foreground sm:text-4xl md:text-[2.75rem]">
              Start with whichever half hurts more
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-primary-foreground/85 sm:text-lg">
              Run a funding scan against your profile, or upload one agreement and see every
              obligation inside it. Both take about a minute, and neither needs a card.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="xl"
                className="sheen-on-hover w-full bg-background text-primary shadow-soft hover:bg-background/92 sm:w-auto"
                onClick={() => onNavigate("/signup")}
              >
                Create your account
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="xl"
                variant="glass-dark"
                className="w-full text-primary-foreground sm:w-auto"
                onClick={() => onNavigate("/login")}
              >
                Sign in
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function SiteFooter({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <footer className="border-t border-border/60 bg-muted/30 px-5 py-14 sm:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Funding and compliance infrastructure for grant-funded organizations. Built so the
              money you could win, and the obligations you signed up for, are both things you can
              actually see.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <FooterCol
              title="Product"
              links={[
                { label: "Services", href: "#platform" },
                { label: "How it works", href: "#how" },
                { label: "Pricing", href: "#pricing" },
                { label: "Security", href: "#security" },
              ]}
            />
            <FooterCol
              title="Account"
              links={[
                { label: "Sign in", onClick: () => onNavigate("/login") },
                { label: "Create account", onClick: () => onNavigate("/signup") },
              ]}
            />
            <FooterCol
              title="Company"
              links={[{ label: "zeusconsultingservices.com", href: "https://zeusconsultingservices.com" }]}
            />
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Zeus Consulting · GrantMatch Innovation</p>
          <p>Built for organizations accountable to their funders.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href?: string; onClick?: () => void }[];
}) {
  return (
    <div>
      <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink">{title}</h4>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            {l.href ? (
              <a
                href={l.href}
                className="text-sm text-muted-foreground transition-colors duration-200 hover:text-primary"
              >
                {l.label}
              </a>
            ) : (
              <button
                onClick={l.onClick}
                className="text-left text-sm text-muted-foreground transition-colors duration-200 hover:text-primary"
              >
                {l.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
