import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Radar,
  Target,
  FileText,
  KanbanSquare,
  ShieldCheck,
  Users,
  Building2,
  GraduationCap,
  Briefcase,
  HeartHandshake,
  ArrowRight,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import heroImage from "@/assets/hero-grantmatch.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ZCS GrantMatch Innovation | AI Grant Discovery & Writing" },
      {
        name: "description",
        content:
          "Stop searching for grants. Build one profile and let ZCS GrantMatch Innovation scan funding worldwide, score your fit, and draft winning proposals with AI.",
      },
      { property: "og:title", content: "ZCS GrantMatch Innovation | AI Grant Discovery & Writing" },
      {
        property: "og:description",
        content:
          "AI-matched grant opportunities, transparent fit scores, and AI-assisted proposal drafting from Zeus Consulting.",
      },
    ],
  }),
  component: Landing,
});

const steps = [
  {
    icon: Target,
    title: "Build your profile once",
    body: "An eight-step guided wizard captures your applicant type, mission, geography, demographics, capacity and funding goals — with a plain-English help tip on every field.",
  },
  {
    icon: Radar,
    title: "We scan the funding world",
    body: "Federal, state, county, foundation, corporate, faith-based, community and international sources are monitored on a cadence that matches your plan.",
  },
  {
    icon: Sparkles,
    title: "You get scored matches",
    body: "Every opportunity carries a 0–100% Fit Score with a transparent breakdown of exactly why it matched — and what's missing.",
  },
  {
    icon: FileText,
    title: "Draft, track, submit",
    body: "Generate a structured proposal draft from your profile and documents, manage it on a Kanban tracker, and export to DOCX or PDF.",
  },
];

const features = [
  {
    icon: Radar,
    title: "Worldwide grant discovery",
    body: "Grants.gov, all 50 state portals, county and municipal programs, foundation directories, corporate giving, SBIR/STTR and international funders.",
  },
  {
    icon: Target,
    title: "Transparent fit scoring",
    body: "Hard filters for applicant type and geography; weighted scoring for focus areas, demographics, budget fit and document readiness.",
  },
  {
    icon: FileText,
    title: "AI proposal drafting",
    body: "Executive summary, need statement, SMART outcomes, evaluation, sustainability and budget narrative — editable in-app and regenerable section by section.",
  },
  {
    icon: KanbanSquare,
    title: "Grant tracker",
    body: "Identified → Researching → Drafting → Submitted → Under Review → Awarded. Drag and drop, notes, tasks, attachments and deadline reminders.",
  },
  {
    icon: ShieldCheck,
    title: "Grant readiness score",
    body: "A scored diagnostic across documents, financials, compliance and governance, with a prioritized action plan to raise your score.",
  },
  {
    icon: Users,
    title: "Teams and client workspaces",
    body: "Owner, Admin, Editor and Viewer roles — plus multi-client workspaces and white-labeled reports for consultants and agencies.",
  },
];

const audiences = [
  { icon: HeartHandshake, label: "Nonprofits", body: "501(c)(3) organizations chasing operating and program funding." },
  { icon: Briefcase, label: "Small business", body: "For-profits, startups and HUBZone or Opportunity Zone applicants." },
  { icon: GraduationCap, label: "Educators", body: "Schools, districts and workforce or STEM programs." },
  { icon: Building2, label: "Consultants", body: "Grant writers and agencies managing many clients at once." },
];

const faqs = [
  {
    q: "How does the free trial work?",
    a: "Choose a plan and add a payment method to begin a three-day free trial. You'll see your exact expiration date and time in your local timezone, and we email you roughly 24 hours before the first charge. Cancel any time before then and you are not charged.",
  },
  {
    q: "What can I do during the trial?",
    a: "Complete your full funding profile, upload one capability statement, run a limited personalized scan, view up to 10 full matches with fit scoring, save 3 opportunities, and generate one preview proposal draft in-app. Export requires a paid plan.",
  },
  {
    q: "Where do the grant opportunities come from?",
    a: "Federal sources such as Grants.gov and SBIR/STTR, all 50 state portals, county and municipal programs, foundation and community foundation directories, corporate giving programs, faith-based grantmakers, and international bodies including EU, UK and UN agencies.",
  },
  {
    q: "Is the AI-generated proposal ready to submit?",
    a: "No. Every draft is AI-generated and requires your review and approval before submission. We do not guarantee accuracy, eligibility, or award outcomes, and drafts are not attorney- or accountant-reviewed.",
  },
  {
    q: "Do I need a DUNS/UEI number or audited financials?",
    a: "Not to get started. Those fields are optional in your profile, and your readiness score will tell you exactly which ones are blocking your strongest matches.",
  },
  {
    q: "Can I cancel or change plans myself?",
    a: "Yes. Upgrade, downgrade or cancel from your billing dashboard without contacting support. Upgrades apply immediately with proration; downgrades take effect at your next renewal and your data is preserved.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-surface-gradient">
          <div className="pointer-events-none absolute -top-40 -right-40 size-[36rem] rounded-full bg-primary/8 blur-3xl" />
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 lg:grid-cols-2 lg:px-8 lg:py-28">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-xs font-bold tracking-[0.12em] text-primary uppercase">
                <span className="size-1.5 rounded-full bg-accent" />
                Protect. Invest. Grow.
              </span>
              <h1 className="mt-6 text-4xl leading-[1.05] text-ink sm:text-5xl lg:text-6xl">
                Stop hunting for grants.
                <span className="block text-primary">Start winning them.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                ZCS GrantMatch Innovation builds one detailed profile of your organization, then
                continuously scans funding sources worldwide and returns only the opportunities you
                have a real chance of winning — with an AI-drafted proposal ready to edit.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Button variant="hero" size="xl" asChild>
                  <Link to="/pricing">
                    Start your 3-day free trial <ArrowRight />
                  </Link>
                </Button>
                <Button variant="outline" size="xl" asChild>
                  <a href="#how-it-works">See how it works</a>
                </Button>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-sm font-medium text-muted-foreground">
                {["Fit score on every match", "Cancel any time in trial", "Built for non-experts"].map(
                  (t) => (
                    <li key={t} className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-accent" />
                      {t}
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div className="relative">
              <div className="overflow-hidden rounded-2xl shadow-lift">
                <img
                  src={heroImage}
                  alt="Layered dashboard panels visualizing matched grant opportunities and fit scores"
                  width={1280}
                  height={1024}
                  className="w-full"
                />
              </div>
              <div className="absolute -bottom-6 -left-4 hidden rounded-xl border border-border bg-card p-4 shadow-soft sm:block">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Fit score
                </p>
                <p className="mt-1 text-3xl font-extrabold text-ink">
                  92<span className="text-lg text-muted-foreground">%</span>
                </p>
                <p className="mt-1 text-xs text-accent-foreground/70">Strong focus area match</p>
              </div>
            </div>
          </div>
        </section>

        {/* Stats strip */}
        <section className="border-y border-border bg-ink">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
            {[
              ["9+", "Funding source categories"],
              ["50", "State portals monitored"],
              ["0–100%", "Transparent fit scoring"],
              ["3 days", "Free trial on every plan"],
            ].map(([big, small]) => (
              <div key={small}>
                <p className="text-3xl font-extrabold text-accent">{big}</p>
                <p className="mt-1 text-sm text-primary-foreground/65">{small}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-24 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">How it works</p>
            <h2 className="mt-3 text-3xl text-ink sm:text-4xl">
              Four steps from “where do I even start?” to a submitted application
            </h2>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <div
                key={s.title}
                className="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-soft"
              >
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary/8 text-primary">
                  <s.icon className="size-5" />
                </div>
                <p className="mt-5 text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
                  Step {i + 1}
                </p>
                <h3 className="mt-2 text-lg text-ink">{s.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-24 bg-muted/60 py-24">
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Platform</p>
              <h2 className="mt-3 text-3xl text-ink sm:text-4xl">
                Everything a funding operation needs, in one place
              </h2>
            </div>
            <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="group rounded-xl border border-border bg-card p-7 transition-all hover:-translate-y-1 hover:shadow-soft"
                >
                  <div className="flex size-11 items-center justify-center rounded-lg bg-accent/15 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <f.icon className="size-5" />
                  </div>
                  <h3 className="mt-5 text-lg text-ink">{f.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Audiences */}
        <section id="audiences" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-24 lg:px-8">
          <div className="grid gap-14 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Who it's for</p>
              <h2 className="mt-3 text-3xl text-ink sm:text-4xl">
                Designed for people who have never used a grant platform
              </h2>
              <p className="mt-5 text-base leading-relaxed text-muted-foreground">
                Every complex field carries a “?” explainer. Guided walkthroughs run the first time you
                open a section, contextual tips appear when a form gets tricky, and an AI assistant is
                always a click away in the corner of the screen.
              </p>
              <Button variant="accent" size="lg" className="mt-8" asChild>
                <Link to="/pricing">Compare plans</Link>
              </Button>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {audiences.map((a) => (
                <div key={a.label} className="rounded-xl border border-border bg-card p-6">
                  <a.icon className="size-6 text-primary" />
                  <h3 className="mt-4 text-base text-ink">{a.label}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 bg-muted/60 py-24">
          <div className="mx-auto max-w-3xl px-5 lg:px-8">
            <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">FAQ</p>
            <h2 className="mt-3 text-3xl text-ink sm:text-4xl">Questions before you start</h2>
            <Accordion type="single" collapsible className="mt-10">
              {faqs.map((f) => (
                <AccordionItem key={f.q} value={f.q}>
                  <AccordionTrigger className="text-left text-base font-semibold text-ink">
                    {f.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* CTA */}
        <section id="about" className="bg-brand-gradient">
          <div className="mx-auto max-w-4xl px-5 py-24 text-center lg:px-8">
            <h2 className="text-3xl text-primary-foreground sm:text-4xl">
              Your next grant is already out there
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-primary-foreground/75">
              Start a three-day free trial, complete your profile, and see your matches with fit scores
              before you pay a cent. Cancel before the trial ends and you won't be charged.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Button variant="accent" size="xl" asChild>
                <Link to="/pricing">
                  Start free trial <ArrowRight />
                </Link>
              </Button>
              <Button variant="outlineLight" size="xl" asChild>
                <a href="#faq">Talk to Zeus Consulting</a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
