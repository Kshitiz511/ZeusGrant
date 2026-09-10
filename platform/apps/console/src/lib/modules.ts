import type { LucideIcon } from "lucide-react";
import { Archive, Brain, ListChecks, ShieldCheck } from "lucide-react";

// Mirrors the legacy app's module catalog + nav, trimmed to what the console
// currently surfaces. Each module groups its nav items in the sidebar; a module
// the tenant isn't entitled to renders as a locked upsell.
export type ModuleId = "grant_intelligence" | "contract_compliance" | "audit_compliance";

export type NavItem = { to: string; label: string; icon: LucideIcon };

export type ModuleMeta = {
  id: ModuleId;
  name: string;
  slug: string;
  startingPrice: number;
  nav: NavItem[];
};

export const MODULES: ModuleMeta[] = [
  {
    id: "grant_intelligence",
    name: "Grant Intelligence",
    slug: "grant-intelligence",
    startingPrice: 49,
    nav: [{ to: "/dashboard", label: "Dashboard", icon: Brain }],
  },
  {
    id: "contract_compliance",
    name: "Contract Compliance",
    slug: "contract-compliance",
    startingPrice: 39,
    nav: [
      { to: "/compliance", label: "Contract Compliance", icon: ShieldCheck },
      { to: "/my-tasks", label: "My Tasks", icon: ListChecks },
    ],
  },
  {
    id: "audit_compliance",
    name: "Audit Vault",
    slug: "audit-vault",
    startingPrice: 29,
    nav: [{ to: "/audit", label: "Audit Vault", icon: Archive }],
  },
];

export function money(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
