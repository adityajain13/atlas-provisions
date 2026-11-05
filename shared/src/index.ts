import { z } from 'zod';

import { DAYS, SLOTS, type Day, type Slot } from './calendar';
import { STORE_GROUPS, STORE_PRESETS, slugifyName } from './stores';
export { DAYS, SLOTS, DAY_LONG, isWeeknight, type Day, type Slot } from './calendar';
export * from './stores';

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
});
export type Store = z.infer<typeof StoreSchema>;

export const ItemRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Item name is required').max(60),
  rule: z.enum(['always', 'never']),
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
  // Canadian postal code, stored uppercase with no space. Flipp flyers are searched near it.
  postalCode: z
    .string()
    .regex(/^[A-Z]\d[A-Z]\d[A-Z]\d$/, 'Postal code looks like M5V2T6')
    .optional(),
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
  INGREDIENTS,
  INGREDIENT_BY_ID,
  type Category,
  type BaseUnit,
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
