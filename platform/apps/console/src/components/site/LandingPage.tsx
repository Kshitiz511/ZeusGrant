import {
  ArrowRight,
  Brain,
  Database,
  FileSearch,
  FileStack,
  KeyRound,
  ListChecks,
  Lock,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { Hero } from "@/components/site/Hero";
import { Reveal, Section, SectionHeading } from "@/components/site/Primitives";
import { SiteNav } from "@/components/site/SiteNav";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
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
        <PlatformSection />
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
    icon: ScrollText,
    title: "The obligations are buried",
    body: "A single award agreement can carry dozens of commitments, scattered across sections and written in language designed for lawyers rather than for the person who has to deliver on them.",
  },
  {
    icon: FileStack,
    title: "The tracking lives in a spreadsheet",
    body: "Someone reads the contract once, types what they find into a sheet, and that sheet immediately begins drifting from the document it came from.",
  },
  {
    icon: Database,
    title: "The deadline arrives before the reminder",
    body: "Nothing is watching the calendar. A missed report is discovered at the audit, which is the most expensive possible moment to find it.",
  },
];

function ProblemSection() {
  return (
    <Section className="border-y border-border/60 bg-muted/30">
      <SectionHeading
        eyebrow="The problem"
        title="Compliance failures are rarely a decision. They are an oversight."
        description="Funded organizations do not miss obligations because they do not care. They miss them because the obligations were never anywhere they could be seen."
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
    icon: Upload,
    step: "01",
    title: "Upload the agreement",
    body: "Drop in a PDF or Word document. Zeus handles long agreements by reading them in sections, so page count is not a limit.",
  },
  {
    icon: FileSearch,
    step: "02",
    title: "AI extracts every obligation",
    body: "Each commitment comes back structured — what is owed, by whom, by when — and carries the exact clause it came from, so nothing has to be taken on trust.",
  },
  {
    icon: ListChecks,
    step: "03",
    title: "Work the queue",
    body: "Obligations become tracked tasks with owners and due dates. Edit anything the model got wrong; your edits are never overwritten by a later re-analysis.",
  },
];

function HowItWorksSection() {
  return (
    <Section id="how">
      <SectionHeading
        eyebrow="How it works"
        title="From signed PDF to a working tracker"
        description="Three steps, and the third one is where your team actually lives."
      />
      <div className="relative mt-14">
        {/* Connecting rule behind the cards. Decorative, so it sits behind and
            is hidden where the cards stack vertically. */}
        <div
          aria-hidden
          className="absolute left-0 right-0 top-[4.25rem] hidden h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent md:block"
        />
        <div className="grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.step} delay={i * 130}>
              <article className="lift-on-hover glass relative h-full rounded-2xl p-7">
                <div className="flex items-center justify-between">
                  <span className="inline-flex size-12 items-center justify-center rounded-xl bg-brand-gradient text-primary-foreground shadow-soft">
                    <s.icon className="size-5" />
                  </span>
                  <span className="text-3xl font-extrabold text-primary/12">{s.step}</span>
                </div>
                <h3 className="mt-5 text-lg font-bold text-ink">{s.title}</h3>
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

const MODULES = [
  {
    icon: ShieldCheck,
    name: "Contract Compliance",
    status: "available" as const,
    body: "Obligation extraction, deadline tracking, a shared task queue and an append-only activity record of everything your team changed.",
    points: ["AI obligation extraction", "Clause-level citations", "Task queue with owners", "Full activity history"],
  },
  {
    icon: Brain,
    name: "Grant Intelligence",
    status: "soon" as const,
    body: "Funding discovery and match scoring against your organization's profile, so you spend your time on the opportunities you can actually win.",
    points: ["Opportunity matching", "Eligibility screening", "Deadline calendar", "Proposal workspace"],
  },
  {
    icon: FileStack,
    name: "Audit Vault",
    status: "soon" as const,
    body: "A single, organized evidence store so audit preparation is a retrieval task rather than an archaeology project.",
    points: ["Evidence library", "Retention tracking", "Audit-ready exports", "Document versioning"],
  },
];

function PlatformSection() {
  return (
    <Section id="platform" className="border-y border-border/60 bg-muted/30">
      <SectionHeading
        eyebrow="The platform"
        title="Three modules. One workspace."
        description="Buy only what you need. Each module is licensed on its own, and every one of them shares the same account, the same team and the same security model."
      />
      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {MODULES.map((m, i) => (
          <Reveal key={m.name} delay={i * 120}>
            <article
              className={cn(
                "lift-on-hover flex h-full flex-col rounded-2xl border bg-background p-7",
                m.status === "available"
                  ? "border-primary/25 shadow-soft"
                  : "border-border/70",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    "inline-flex size-11 items-center justify-center rounded-xl",
                    m.status === "available"
                      ? "bg-brand-gradient text-primary-foreground shadow-soft"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <m.icon className="size-5" />
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider",
                    m.status === "available"
                      ? "bg-success/12 text-success"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {m.status === "available" ? "Available" : "Coming soon"}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-bold text-ink">{m.name}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{m.body}</p>
              <ul className="mt-5 space-y-2.5 border-t border-border/60 pt-5">
                {m.points.map((p) => (
                  <li key={p} className="flex items-center gap-2.5 text-sm text-foreground">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        m.status === "available" ? "bg-accent" : "bg-muted-foreground/40",
                      )}
                    />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          </Reveal>
        ))}
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
          description="You are handling funder agreements and audit evidence. The guarantees below are structural — they hold because of how the system is built, not because of how carefully it is used."
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

const TIERS = [
  {
    name: "Starter",
    price: "39",
    tagline: "For a single programme or a first funded contract.",
    features: ["1 workspace", "Up to 10 contracts", "AI obligation extraction", "Task queue & reminders", "Email support"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Growth",
    price: "99",
    tagline: "For teams running several awards at once.",
    features: ["Everything in Starter", "Up to 100 contracts", "Unlimited team members", "Activity & audit history", "Priority support"],
    cta: "Start free",
    featured: true,
  },
  {
    name: "Enterprise",
    price: null,
    tagline: "For organizations with procurement and security review.",
    features: ["Everything in Growth", "Unlimited contracts", "Custom retention policy", "Security questionnaire support", "Dedicated onboarding"],
    cta: "Talk to us",
    featured: false,
  },
];

function PricingSection({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <Section id="pricing" className="border-y border-border/60 bg-muted/30">
      <SectionHeading
        eyebrow="Pricing"
        title="Priced per module, billed monthly"
        description="Start on a free trial. Add a card when you are ready to keep going — not before."
      />
      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {TIERS.map((t, i) => (
          <Reveal key={t.name} delay={i * 110}>
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
                {t.price ? (
                  <>
                    <span className="text-4xl font-extrabold tracking-tight text-ink">
                      ${t.price}
                    </span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </>
                ) : (
                  <span className="text-4xl font-extrabold tracking-tight text-ink">Custom</span>
                )}
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
                {t.cta}
              </Button>
            </article>
          </Reveal>
        ))}
      </div>
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
              Stop reading contracts twice
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-primary-foreground/85 sm:text-lg">
              Upload your first agreement and see every obligation it contains in under a
              minute.
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
              Compliance infrastructure for grant-funded organizations. Built so the
              obligations you signed up for are the obligations you can see.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <FooterCol
              title="Product"
              links={[
                { label: "Platform", href: "#platform" },
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
