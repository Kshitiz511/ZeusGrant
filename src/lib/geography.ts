import type { Tables } from "@/integrations/supabase/types";

export type OrgProfile = Tables<"org_profiles">;

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR",
  "PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR","VI","GU","AS","MP",
] as const;

export const SERVICE_AREA_SCOPES = [
  "Local",
  "County",
  "Multi-County",
  "Statewide",
  "Multi-State",
  "Regional",
  "Nationwide",
] as const;

export const SCOPE_PREFERENCES = [
  "Only my current area",
  "My state(s)",
  "My region",
  "Selected states",
  "Nationwide",
  "Anywhere I am eligible",
] as const;

export const YES_NO_MAYBE = ["Yes", "No", "Depends on the opportunity"] as const;
export const RELOCATION_OPTIONS = ["Yes", "No", "Maybe"] as const;

/** Standard U.S. regions supported by the discovery engine. */
export const REGIONS: Record<string, string[]> = {
  "New England": ["CT", "ME", "MA", "NH", "RI", "VT"],
  Northeast: ["CT", "ME", "MA", "NH", "RI", "VT", "NY", "NJ", "PA"],
  "Mid-Atlantic": ["NY", "NJ", "PA", "DE", "MD", "DC", "VA", "WV"],
  Southeast: ["FL", "GA", "AL", "SC", "NC", "TN", "MS", "KY", "AR", "LA", "VA"],
  "Deep South": ["AL", "GA", "LA", "MS", "SC"],
  "Gulf Coast": ["TX", "LA", "MS", "AL", "FL"],
  Midwest: ["IL", "IN", "IA", "KS", "MI", "MN", "MO", "NE", "ND", "OH", "SD", "WI"],
  "Great Lakes": ["IL", "IN", "MI", "MN", "NY", "OH", "PA", "WI"],
  Appalachia: ["WV", "KY", "TN", "VA", "OH", "PA", "NC", "AL", "MS", "MD", "NY", "SC", "GA"],
  Southwest: ["TX", "OK", "NM", "AZ"],
  "Mountain West": ["CO", "ID", "MT", "NV", "UT", "WY"],
  "West Coast": ["CA", "OR", "WA"],
  "Pacific Northwest": ["OR", "WA", "ID", "AK"],
};

const normalize = (v: string) => v.trim().toUpperCase();

/** Computed `user_funding_geography` — the source of truth every search runs against. */
export type UserFundingGeography = {
  federal: true;
  nationwidePrivate: true;
  regions: string[];
  states: string[];
  homeState: string | null;
  counties: string[];
  cities: string[];
  expansionStates: string[];
  serviceAreaScope: string | null;
  scopePreference: string;
  projectLocationFlexibility: string | null;
  relocationWillingness: string | null;
  lastComputed: string;
};

export function computeUserFundingGeography(org: OrgProfile | null): UserFundingGeography {
  const homeState = org?.state ? normalize(org.state) : null;
  const operating = (org?.operating_states ?? []).map(normalize);
  const expansion = (org?.target_expansion_markets ?? []).map(normalize);
  const relocation = org?.relocation_willingness ?? null;

  const states = Array.from(
    new Set(
      [homeState, ...operating, ...(relocation === "Yes" ? expansion : [])].filter(
        (s): s is string => Boolean(s),
      ),
    ),
  );

  const regions = Object.entries(REGIONS)
    .filter(([, members]) => members.some((m) => states.includes(m)))
    .map(([name]) => name);

  return {
    federal: true,
    nationwidePrivate: true,
    regions,
    states,
    homeState,
    counties: (org?.counties_served ?? []).map((c) => c.trim()).filter(Boolean),
    cities: org?.city ? [org.city.trim()] : [],
    expansionStates: expansion,
    serviceAreaScope: org?.service_area_scope ?? null,
    scopePreference: org?.geographic_scope_preference ?? "Anywhere I am eligible",
    projectLocationFlexibility: org?.project_location_flexibility ?? null,
    relocationWillingness: relocation,
    lastComputed: new Date().toISOString(),
  };
}

export type GeoClassification =
  | "LOCAL"
  | "HOME STATE"
  | "REGIONAL"
  | "NATIONAL"
  | "TARGET MARKET"
  | "OUT OF AREA";

export const GEO_LABEL: Record<GeoClassification, string> = {
  LOCAL: "Local",
  "HOME STATE": "Home state",
  REGIONAL: "Regional",
  NATIONAL: "National",
  "TARGET MARKET": "Expansion opportunity",
  "OUT OF AREA": "Outside your area",
};

export function classifyGeography(
  geo: UserFundingGeography,
  opp: {
    eligible_states: string[];
    eligible_counties: string[];
    eligible_cities: string[];
    geo_level: string;
  },
): GeoClassification {
  const states = opp.eligible_states.map(normalize);
  if (!states.length) return "NATIONAL";

  const cityHit = opp.eligible_cities.some((c) =>
    geo.cities.some((g) => normalize(g) === normalize(c)),
  );
  const countyHit = opp.eligible_counties.some((c) =>
    geo.counties.some((g) => normalize(g) === normalize(c)),
  );
  const inStates = states.some((s) => geo.states.includes(s));
  const isExpansion = states.some((s) => geo.expansionStates.includes(s));

  if ((cityHit || countyHit) && inStates) return "LOCAL";
  if (opp.eligible_counties.length || opp.eligible_cities.length) {
    return isExpansion && !inStates ? "TARGET MARKET" : "OUT OF AREA";
  }
  if (opp.geo_level === "regional" && inStates) return "REGIONAL";
  if (geo.homeState && states.includes(geo.homeState)) return "HOME STATE";
  if (inStates) return "HOME STATE";
  if (isExpansion) return "TARGET MARKET";
  return "OUT OF AREA";
}

export function expansionExplainer(
  geo: UserFundingGeography,
  opp: { eligible_states: string[]; funder: string },
) {
  const target = opp.eligible_states.find((s) => geo.expansionStates.includes(normalize(s)));
  if (!target) return null;
  const home = geo.homeState ? `headquartered in ${geo.homeState}` : "based elsewhere";
  return `Your organization is ${home}, but this ${target} opportunity permits applicants that establish operations within ${target}. You listed ${target} as a target expansion market.`;
}
