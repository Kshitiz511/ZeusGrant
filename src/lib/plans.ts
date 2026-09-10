export type Plan = {
  id: string;
  name: string;
  tagline: string;
  monthly: number | null;
  annual: number | null;
  monthlyPriceId?: string;
  annualPriceId?: string;
  popular?: boolean;
  features: string[];
};

export const TRIAL_DAYS = 3;

export function planPriceId(plan: Plan, annual: boolean): string | undefined {
  return annual ? plan.annualPriceId : plan.monthlyPriceId;
}


export const PLANS: Plan[] = [
  {
    id: "starter",
    monthlyPriceId: "starter_monthly",
    annualPriceId: "starter_annual",
    name: "Starter",
    tagline: "Individuals and very small organizations.",
    monthly: 49,
    annual: 490,
    features: [
      "1 applicant profile",
      "Monthly funding scan",
      "Up to 25 personalized matches/month",
      "Basic eligibility screening and fit scoring",
      "5 saved opportunities",
      "1 proposal draft/month",
      "Deadline alerts and source links",
      "Basic grant readiness assessment",
    ],
  },
  {
    id: "growth",
    monthlyPriceId: "growth_monthly",
    annualPriceId: "growth_annual",
    name: "Growth",
    tagline: "Small businesses, nonprofits and education programs.",
    monthly: 99,
    annual: 990,
    popular: true,
    features: [
      "1 org + up to 3 team members",
      "Weekly funding scans",
      "Up to 100 personalized matches/month",
      "Complete eligibility analysis + transparent fit scoring",
      "Unlimited saved opportunities",
      "5 proposal drafts/month",
      "Grant tracker, compliance matrices, document center",
      "DOCX and PDF export + email opportunity reports",
    ],
  },
  {
    id: "professional",
    monthlyPriceId: "professional_monthly",
    annualPriceId: "professional_annual",
    name: "Professional",
    tagline: "Teams actively pursuing multiple funding sources.",
    monthly: 199,
    annual: 1990,
    features: [
      "1 org + up to 10 team members",
      "Daily funding monitoring",
      "Advanced matching and scoring",
      "15 proposal drafts/month",
      "Advanced compliance reviews + version history",
      "Collaboration and task assignment",
      "Advanced reporting and calendar integration",
      "Priority support",
    ],
  },
  {
    id: "agency",
    monthlyPriceId: "agency_monthly",
    annualPriceId: "agency_annual",
    name: "Consultant / Agency",
    tagline: "Grant writers, accelerators, multi-client managers.",
    monthly: 399,
    annual: 3990,
    features: [
      "Up to 10 client workspaces, 25 users",
      "Daily opportunity monitoring",
      "Client-specific profiles and matches",
      "40 proposal drafts/month",
      "White-labeled, client-ready exports",
      "Centralized tracker across all clients",
      "Proposal templates and usage analytics",
      "Priority support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Custom orgs, integrations and security controls.",
    monthly: null,
    annual: null,
    features: [
      "Custom orgs and users",
      "Custom funding-source integrations",
      "API access and SSO",
      "Custom security controls and audit logs",
      "Dedicated onboarding and account support",
      "Negotiated proposal drafting limits",
    ],
  },
];
