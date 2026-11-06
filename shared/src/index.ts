import { z } from 'zod';

import { DAYS, SLOTS, type Day, type Slot } from './calendar';
import {
  DEFAULT_STORE_PREFERENCE,
  MAX_MIN_SAVING,
  SITE_BANNER_IDS,
  STORE_GROUPS,
  STORE_PREFERENCE_MODES,
  STORE_PRESETS,
  slugifyName,
} from './stores';
import { DEFAULT_STORAGE, StorageSchema } from './storage';
import { FoodFormSchema } from './forms';
import { CUISINE_LEVELS, DEFAULT_ON_HAND, defaultCuisines } from './cuisines';
import { formatPostalCode, normalizePostalCode } from './flipp';
export {
  DAYS,
  SLOTS,
  DAY_LONG,
  MONTH_NAMES,
  PLAN_RETENTION_WEEKS,
  WEEKS_AHEAD,
  WEEKS_BACK,
  addWeeks,
  isSunday,
  isWeeknight,
  monthOfWeek,
  weekRangeLabel,
  weekShortRange,
  type Day,
  type Slot,
} from './calendar';
export * from './stores';
export * from './tnt';
export * from './geo';

export const UNITS = ['g', 'kg', 'ml', 'l', 'each'] as const;
export type Unit = (typeof UNITS)[number];

export const ALLERGEN_PRESETS: string[] = [
  'peanut',
  'tree nut',
  'dairy',
  'egg',
  'gluten',
  'soy',
  'shellfish',
  'fish',
  'sesame',
];

export const DEFAULT_EQUIPMENT: string[] = [
  'Oven',
  'Stovetop',
  'Microwave',
  'Air fryer',
  'Instant Pot',
  'Slow cooker',
  'Rice cooker',
  'Blender',
  'Food processor',
  'Stand mixer',
  'Grill / BBQ',
  'Toaster oven',
  'Sous vide',
];

export const VARIETY_RULES = [
  { key: 'noRepeatProteinConsecutive', label: 'No same protein two days in a row' },
  { key: 'noRepeatDinner14', label: 'No repeat dinner within 14 days' },
  { key: 'minVeg5', label: 'At least 5 vegetables a week' },
  { key: 'oneVegDinner', label: 'One vegetarian dinner a week' },
] as const;
export type VarietyRuleKey = (typeof VARIETY_RULES)[number]['key'];

const DaySchema = z.enum(DAYS);
const SlotSchema = z.enum(SLOTS);

export const PersonSchema = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(40, 'Name must be 40 characters or fewer'),
  proteinTargetG: z.number().min(0, 'Protein target cannot be negative').optional(),
  dietTags: z.array(z.string()),
  allergies: z.array(z.string()),
});
export type Person = z.infer<typeof PersonSchema>;

// schedule[personId][day][slot] = whether that person eats that meal by default
export const ScheduleSchema = z.record(z.record(z.record(z.boolean())));
export type Schedule = z.infer<typeof ScheduleSchema>;

export const IngredientSchema = z.object({
  name: z.string().min(1, 'Ingredient name is required').max(60),
  qty: z.number().min(0, 'Quantity cannot be negative'),
  unit: z.enum(UNITS),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const FixedMealSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Meal name is required').max(80),
  personIds: z.array(z.string()),
  days: z.array(DaySchema),
  slot: SlotSchema,
  ingredients: z.array(IngredientSchema),
  active: z.boolean(),
});
export type FixedMeal = z.infer<typeof FixedMealSchema>;

export const EquipmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Equipment name is required').max(40),
  owned: z.boolean(),
  builtin: z.boolean(),
});
export type Equipment = z.infer<typeof EquipmentSchema>;

export const StoreSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  enabled: z.boolean(),
  priceMatches: z.boolean(),
  // Optional, so households stored before presets still parse.
  group: z.enum(STORE_GROUPS).optional(),
  // Extra merchant names Flipp uses for this store (e.g. "RCSS" for Real Canadian Superstore).
  flippNames: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  // Where the store is, for a store without a location picker. Optional: stored stores without it still parse.
  address: z.string().trim().min(1).max(160).optional(),
  // The store location whose regular shelf prices are read (Loblaw-family stores only). Optional: stored stores without it still parse.
  siteStore: z
    .object({
      banner: z.enum(SITE_BANNER_IDS),
      storeId: z.string().trim().min(1).max(10),
      label: z.string().trim().min(1).max(160),
    })
    .optional(),
});
export type Store = z.infer<typeof StoreSchema>;

export const ItemRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Item name is required').max(60),
  // 'pin' buys the item at its store whenever it is on the list, without putting it on the list.
  rule: z.enum(['always', 'never', 'pin']),
  // Ingredient ids the household un-ticked from a never-buy name. Optional, so stored rules without it still parse.
  except: z.array(z.string().min(1)).optional(),
  // Where to buy it: a store name. An always-buy rule with a store is pinned there; a 'pin' rule has one.
  store: z.string().trim().min(1).max(40).optional(),
  // The catalogue ingredient a 'pin' rule is for, so the pin does not depend on how the name matches.
  ingredientId: z.string().min(1).optional(),
});
export type ItemRule = z.infer<typeof ItemRuleSchema>;

export const HouseholdSchema = z.object({
  people: z.array(PersonSchema),
  schedule: ScheduleSchema,
  fixedMeals: z.array(FixedMealSchema),
  equipment: z.array(EquipmentSchema),
  varietyRules: z.record(z.boolean()),
  stores: z.array(StoreSchema),
  maxStores: z.number().int().min(1).max(5),
  defaultBudget: z.number().min(0, 'Budget cannot be negative'),
  itemRules: z.array(ItemRuleSchema),
  // timeCaps[day][slot] = most active minutes a meal in that slot may take (busy nights).
  timeCaps: z.record(z.record(z.number().int().min(5).max(180))).default({}),
  // Day to batch-prep for (Sunday to Saturday), or null for none. Stored households without it get Sunday.
  prepDay: z.enum(DAYS).nullable().default('sun'),
  // Canadian postal code, stored as "M5V 2T6". Flipp flyers are searched near it. Stored codes without the space parse too.
  postalCode: z
    .string()
    .refine((s) => normalizePostalCode(s) !== null, 'Postal code looks like M5V 2T6')
    .transform((s) => formatPostalCode(s) ?? s)
    .optional(),
  // How close store totals are settled: the cheapest, or the store list's order when they nearly tie.
  // Stored households without it get the default.
  storePreference: z
    .object({
      mode: z.enum(STORE_PREFERENCE_MODES),
      minSaving: z.number().min(0, 'Saving cannot be negative').max(MAX_MIN_SAVING),
    })
    .default(DEFAULT_STORE_PREFERENCE),
  // Dishes the household does not want planned, as typed: "slaw" rules out coleslaw. Stored households without it get none.
  avoidDishes: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  // Forms the household keeps, per group (fish, beans, ...). A missing group keeps every form.
  forms: z.record(z.string(), z.array(FoodFormSchema)).default({}),
  // What storage the household has. Stored households without it get the defaults.
  storage: StorageSchema.default(DEFAULT_STORAGE),
  // How often the household eats each cuisine (see cuisines.ts). A missing cuisine reads as its default.
  cuisines: z.record(z.string(), z.enum(CUISINE_LEVELS)).default(defaultCuisines),
  // Catalogue ids of the spices and staples the household keeps: plans use them freely and they never go on the list.
  onHand: z.array(z.string().min(1).max(80)).max(300).default(() => [...DEFAULT_ON_HAND]),
  // Staples the household keeps that have no catalogue entry, as typed ("chili oil" before it was added). Free, like onHand, never on the list.
  onHandCustom: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  // Prefer produce that is in season in Ontario this month. Off: the planner ignores the calendar.
  preferSeasonal: z.boolean().default(true),
  // False while the first-time setup wizard is unfinished. Missing means done, so existing households never see it.
  setupDone: z.boolean().optional(),
});
export type Household = z.infer<typeof HouseholdSchema>;

const DEFAULT_STORE_IDS = ['no-frills', 'freshco', 'food-basics', 'walmart'];

export function defaultHousehold(): Household {
  return {
    people: [],
    schedule: {},
    fixedMeals: [],
    equipment: DEFAULT_EQUIPMENT.map((name) => ({
      id: slugifyName(name),
      name,
      owned: false,
      builtin: true,
    })),
    varietyRules: Object.fromEntries(VARIETY_RULES.map((r) => [r.key, false])),
    stores: DEFAULT_STORE_IDS.flatMap((id) => {
      const preset = STORE_PRESETS.find((p) => p.id === id);
      if (!preset) return [];
      return [
        {
          id: preset.id,
          name: preset.name,
          enabled: false,
          priceMatches: preset.priceMatches,
          group: preset.group,
          ...(preset.flippNames ? { flippNames: [...preset.flippNames] } : {}),
        },
      ];
    }),
    maxStores: 2,
    defaultBudget: 150,
    itemRules: [],
    timeCaps: {},
    prepDay: 'sun',
    avoidDishes: [],
    forms: {},
    storage: { ...DEFAULT_STORAGE },
    storePreference: { ...DEFAULT_STORE_PREFERENCE },
    cuisines: defaultCuisines(),
    onHand: [...DEFAULT_ON_HAND],
    onHandCustom: [],
    preferSeasonal: true,
  };
}

export function newId(): string {
  return crypto.randomUUID();
}

// Flyer ingest, catalogue and deal scoring (milestone 2A).
// The catalogue's Ingredient interface is exported as CatalogIngredient because
// this file already exports the zod Ingredient schema type above.
export {
  CATEGORY_ORDER,
  COOK_AMOUNTS,
  INGREDIENTS,
  INGREDIENT_BY_ID,
  inSeason,
  type Category,
  type BaseUnit,
  type CookAmount,
  type CookUnit,
  type FoodForm,
  type FormGroupKey,
  type Ingredient as CatalogIngredient,
} from './catalog';
export * from './parse';
export * from './match';
export * from './scoring';
export * from './units';
export * from './offers';
export * from './plan';
export * from './grid';
export * from './fixed';
export * from './validate';
export * from './pantry';
export * from './ratings';
export * from './prep';
export * from './receipt';
export * from './flipp';
export * from './checks';
export * from './households';
export * from './itemRules';
export * from './swap';
export * from './mealStatus';
export * from './repair';
export * from './storage';
export * from './forms';
export * from './dishes';
export * from './amounts';
export * from './repeats';
export * from './feedback';
export * from './tntSyncScript';
export * from './tntBookmarklet';
export * from './cuisines';
export * from './stepEdits';
