import type { LucideIcon } from "lucide-react";
import { Archive, History, ListChecks, Radar, ShieldCheck, Target } from "lucide-react";

// The service catalogue.
//
// Each service is sold on its own, so this is the single place that says what
// exists, what it costs, and which routes belong to it. Both the authenticated
// console and the public marketing page read from here, which is what stops
// the two from disagreeing about what we sell.
//
// A route no service claims is platform-wide and needs no subscription, which
// is what lets a tenant who has bought nothing still reach Billing.

export type ModuleId = "grant_intelligence" | "contract_compliance" | "audit_compliance";

export type NavItem = { to: string; label: string; icon: LucideIcon };

/**
 * Whether the service is actually built.
 *
 * Load-bearing rather than decoration: the sidebar refuses to render nav for a
 * `coming_soon` service even when a subscription exists, so a mis-issued
 * entitlement cannot produce menu items that lead nowhere.
 */
export type ModuleStatus = "available" | "coming_soon";

export type ModuleMeta = {
  id: ModuleId;
  name: string;
  slug: string;
  icon: LucideIcon;
  status: ModuleStatus;
  /** One line, used by the sidebar and the locked-service upsell. */
  tagline: string;
  /** The marketing paragraph. Longer than the tagline, same claim. */
  summary: string;
  /** What it does. Only claims that are implemented. */
  points: string[];
  /** Cheapest live plan, in dollars per month. Mirrors platform.plans. */
  startingPrice: number;
  nav: NavItem[];
};

export const MODULES: ModuleMeta[] = [
  {
    id: "grant_intelligence",
    name: "Grant Intelligence",
    slug: "grant-intelligence",
    icon: Target,
    status: "available",
    tagline: "Find the funding you can actually win.",
    summary:
      "Every open federal opportunity, scored against your organisation's profile. Each score shows the reasoning behind it — eligibility, geography, focus area, award size — so you can tell a real match from a keyword collision.",
    points: [
      "Scored against your funding profile",
      "The reasoning behind every score",
      "Eligibility and geography screening",
      "Closed opportunities drop out automatically",
    ],
    startingPrice: 49,
    nav: [
      { to: "/matches", label: "Matches", icon: Target },
      { to: "/funding-profile", label: "Funding profile", icon: Radar },
    ],
  },
  {
    id: "contract_compliance",
    name: "Contract Compliance",
    slug: "contract-compliance",
    icon: ShieldCheck,
    status: "available",
    tagline: "Every obligation, tracked back to its clause.",
    summary:
      "Upload an award agreement and get back every obligation, deadline and financial term it contains — each one carrying the exact contract language it came from, so nothing has to be taken on trust.",
    points: [
      "AI obligation extraction",
      "Clause-level citations",
      "Task queue with owners and due dates",
      "Append-only activity history",
    ],
    startingPrice: 39,
    nav: [
      { to: "/compliance", label: "Contracts", icon: ShieldCheck },
      { to: "/my-tasks", label: "My Tasks", icon: ListChecks },
      { to: "/activity", label: "Activity", icon: History },
    ],
  },
  {
    id: "audit_compliance",
    name: "Audit Vault",
    slug: "audit-vault",
    icon: Archive,
    status: "coming_soon",
    tagline: "Audit prep as retrieval, not archaeology.",
    summary:
      "A single organised evidence store, so that when the auditor asks for something you retrieve it instead of reconstructing it.",
    points: ["Evidence library", "Retention tracking", "Audit-ready exports", "Document versioning"],
    startingPrice: 59,
    nav: [{ to: "/audit", label: "Audit Vault", icon: Archive }],
  },
];

/** The services that are actually built, in display order. */
export const LIVE_MODULES = MODULES.filter((m) => m.status === "available");

/**
 * Which service owns a route, or null for platform-wide pages.
 *
 * Derived from the nav above rather than kept as a second list, so adding a
 * route to a service cannot leave its access check behind.
 */
export function moduleForRoute(key: string): ModuleMeta | null {
  return MODULES.find((m) => m.nav.some((n) => n.to === key)) ?? null;
}

export function money(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
