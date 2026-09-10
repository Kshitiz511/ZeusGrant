import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/brand/Logo";

export const LEGAL_DISCLAIMER =
  "ZCS GrantMatch Innovation provides funding research, matching, tracking, and AI-assisted drafting tools. Subscription fees do not guarantee eligibility, application acceptance, or receipt of an award. Users are responsible for reviewing all opportunity requirements and approving the accuracy of submitted materials.";

const groups = [
  {
    title: "Platform",
    items: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Features", href: "/#features" },
      { label: "Pricing", href: "/pricing" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Who it's for",
    items: [
      { label: "Nonprofits", href: "/#audiences" },
      { label: "Small business", href: "/#audiences" },
      { label: "Educators", href: "/#audiences" },
      { label: "Consultants & agencies", href: "/#audiences" },
    ],
  },
  {
    title: "Company",
    items: [
      { label: "Zeus Consulting", href: "/#about" },
      { label: "Contact support", href: "/#faq" },
      { label: "Terms of Service", href: "/#faq" },
      { label: "Privacy Policy", href: "/#faq" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-ink text-primary-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo tone="light" />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-primary-foreground/65">
              Protect. Invest. Grow. Funding intelligence for organizations that don't have time to
              hunt for grants.
            </p>
          </div>
          {groups.map((g) => (
            <div key={g.title}>
              <h3 className="text-xs font-bold tracking-[0.16em] text-accent uppercase">{g.title}</h3>
              <ul className="mt-4 space-y-3">
                {g.items.map((i) => (
                  <li key={i.label}>
                    <a
                      href={i.href}
                      className="text-sm text-primary-foreground/70 transition-colors hover:text-primary-foreground"
                    >
                      {i.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-primary-foreground/15 pt-8">
          <p className="max-w-4xl text-xs leading-relaxed text-primary-foreground/55">
            {LEGAL_DISCLAIMER}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-primary-foreground/50">
            <span>© {new Date().getFullYear()} Zeus Consulting. All rights reserved.</span>
            <Link to="/pricing" className="font-semibold text-accent hover:underline">
              Start your 3-day free trial
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
