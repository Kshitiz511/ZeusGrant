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
export type PricingTier = {
  plan: string;
  name: string;
  price: number;
  tagline: string;
  features: string[];
  featured: boolean;
};

export const PRICING: Record<string, PricingTier[]> = {
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

