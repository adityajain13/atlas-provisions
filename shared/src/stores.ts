// Store presets: the Ontario chains the Household screen offers, and the defaults for a new household.
// Pure data, slugs and the store preference defaults, no imports, so index.ts can use it without a cycle.

export const STORE_GROUPS = ['Loblaw', 'Metro', 'Sobeys', 'Other'] as const;
export type StoreGroup = (typeof STORE_GROUPS)[number];

export interface StorePreset {
  id: string;
  name: string;
  group: StoreGroup;
  priceMatches: boolean;
  /** Extra merchant names Flipp uses for this store, matched like the name. */
  flippNames?: string[];
}

// Price-match policies change and vary by store; these are defaults the user can toggle.
export const STORE_PRESETS: StorePreset[] = [
  // Loblaw
  { id: 'loblaws', name: 'Loblaws', group: 'Loblaw', priceMatches: false, flippNames: ['Loblaws City Market'] },
  { id: 'no-frills', name: 'No Frills', group: 'Loblaw', priceMatches: true, flippNames: ['NOFRILLS'] },
  {
    id: 'real-canadian-superstore',
    name: 'Real Canadian Superstore',
    group: 'Loblaw',
    priceMatches: true,
    flippNames: ['Superstore', 'RCSS'],
  },
  { id: 'zehrs', name: 'Zehrs', group: 'Loblaw', priceMatches: false },
  { id: 'fortinos', name: 'Fortinos', group: 'Loblaw', priceMatches: false },
  { id: 'valu-mart', name: 'Valu-mart', group: 'Loblaw', priceMatches: false },
  {
    id: 'your-independent-grocer',
    name: 'Your Independent Grocer',
    group: 'Loblaw',
    priceMatches: false,
    flippNames: ['YIG'],
  },
  { id: 'shoppers-drug-mart', name: 'Shoppers Drug Mart', group: 'Loblaw', priceMatches: false },
  // Metro
  { id: 'metro', name: 'Metro', group: 'Metro', priceMatches: false },
  { id: 'food-basics', name: 'Food Basics', group: 'Metro', priceMatches: false },
  { id: 'adonis', name: 'Adonis', group: 'Metro', priceMatches: false },
  // Sobeys
  { id: 'sobeys', name: 'Sobeys', group: 'Sobeys', priceMatches: false },
  { id: 'freshco', name: 'FreshCo', group: 'Sobeys', priceMatches: false },
  { id: 'foodland', name: 'Foodland', group: 'Sobeys', priceMatches: false },
  { id: 'longos', name: "Longo's", group: 'Sobeys', priceMatches: false, flippNames: ['Longos'] },
  { id: 'farm-boy', name: 'Farm Boy', group: 'Sobeys', priceMatches: false, flippNames: ['Farm Boy Markets'] },
  // Other
  { id: 'walmart', name: 'Walmart', group: 'Other', priceMatches: true },
  { id: 'costco', name: 'Costco', group: 'Other', priceMatches: false },
  { id: 'tt-supermarket', name: 'T&T Supermarket', group: 'Other', priceMatches: false, flippNames: ['T&T'] },
  { id: 'giant-tiger', name: 'Giant Tiger', group: 'Other', priceMatches: false },
  { id: 'nations-fresh-foods', name: 'Nations Fresh Foods', group: 'Other', priceMatches: false },
  { id: 'whole-foods-market', name: 'Whole Foods Market', group: 'Other', priceMatches: false },
  { id: 'al-premium-food-mart', name: 'Al Premium Food Mart', group: 'Other', priceMatches: false },
];

/** The id a typed store name gets: lowercase words joined by dashes. Empty when the name has no letters or digits. */
export function slugifyName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// How a household picks between stores whose totals are close. 'cheapest' always takes the lowest total.
// 'prefer' keeps the higher-ranked store (the store list's order) unless a lower-ranked one saves at least minSaving.
export const STORE_PREFERENCE_MODES = ['cheapest', 'prefer'] as const;
export type StorePreferenceMode = (typeof STORE_PREFERENCE_MODES)[number];

export interface StorePreference {
  mode: StorePreferenceMode;
  /** Dollars a lower-ranked store must save before it wins. 0 to 50. */
  minSaving: number;
}

export const MAX_MIN_SAVING = 50;
export const DEFAULT_STORE_PREFERENCE: StorePreference = { mode: 'prefer', minSaving: 3 };
