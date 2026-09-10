export type AddOn = {
  id: string;
  priceId: string;
  name: string;
  price: number;
  drafts: number;
  /** Permanent extra contract slots for the Contract Compliance Tracker. */
  contractSlots?: number;
  description: string;
  /** Shown at the limit-reached screen. */
  primary?: boolean;
};

/** One-time purchases. Prices are administered in the payments dashboard. */
export const ADD_ONS: AddOn[] = [
  {
    id: "addon_contracts_3",
    priceId: "addon_contracts_3_once",
    name: "3 additional contract uploads",
    price: 39,
    drafts: 0,
    contractSlots: 3,
    description:
      "One-time purchase; adds 3 permanent contract slots to the Contract Compliance Tracker.",
  },
  {
    id: "addon_contracts_10",
    priceId: "addon_contracts_10_once",
    name: "10 additional contract uploads",
    price: 99,
    drafts: 0,
    contractSlots: 10,
    description:
      "Bulk discount; adds 10 permanent contract slots to the Contract Compliance Tracker.",
  },

  {
    id: "addon_drafts_5",
    priceId: "addon_drafts_5_once",
    name: "5 additional proposal drafts",
    price: 29,
    drafts: 5,
    description: "One-time purchase; valid for the current billing cycle only; does not roll over.",
    primary: true,
  },
  {
    id: "addon_drafts_10",
    priceId: "addon_drafts_10_once",
    name: "10 additional proposal drafts",
    price: 49,
    drafts: 10,
    description: "Bulk discount; valid for the current billing cycle only; does not roll over.",
    primary: true,
  },
  {
    id: "addon_human_review",
    priceId: "addon_human_review_once",
    name: "Human proposal review",
    price: 149,
    drafts: 0,
    description: "Expert review of one completed draft. Turnaround time is confirmed by email after purchase.",
  },
  {
    id: "addon_template_pack",
    priceId: "addon_template_pack_once",
    name: "Proposal template pack",
    price: 19,
    drafts: 0,
    description: "5 industry-specific starter templates for plans without template access.",
  },
  {
    id: "addon_full_service",
    priceId: "addon_full_service_once",
    name: "Full-service grant writing",
    price: 499,
    drafts: 0,
    description: "A grant writer produces your complete proposal. Scope confirmed before work begins.",
  },
];

export const DRAFT_ADD_ONS = ADD_ONS.filter((a) => a.drafts > 0);

export function addOnByPriceId(priceId: string): AddOn | undefined {
  return ADD_ONS.find((a) => a.priceId === priceId);
}

export function addOnById(id: string): AddOn | undefined {
  return ADD_ONS.find((a) => a.id === id);
}

/** Add-ons that grant permanent extra contract slots. */
export const CONTRACT_ADD_ONS = ADD_ONS.filter((a) => (a.contractSlots ?? 0) > 0);

/** Total contract slots granted by a list of paid add-on purchase ids. */
export function contractSlotsFromPurchases(addonIds: string[]): number {
  return addonIds.reduce((total, id) => total + (addOnById(id)?.contractSlots ?? 0), 0);
}
