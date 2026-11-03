import { z } from 'zod';

export const DAYS = ['thu', 'fri', 'sat', 'sun', 'mon', 'tue', 'wed'] as const; // flyer week order, Thu to Wed
export type Day = (typeof DAYS)[number];

export const SLOTS = ['breakfast', 'lunch', 'dinner'] as const;
export type Slot = (typeof SLOTS)[number];

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
});
export type Household = z.infer<typeof HouseholdSchema>;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function defaultHousehold(): Household {
  return {
    people: [],
    schedule: {},
    fixedMeals: [],
    equipment: DEFAULT_EQUIPMENT.map((name) => ({
      id: slugify(name),
      name,
      owned: false,
      builtin: true,
    })),
    varietyRules: Object.fromEntries(VARIETY_RULES.map((r) => [r.key, false])),
    stores: [
      { id: 'no-frills', name: 'No Frills', enabled: false, priceMatches: true },
      { id: 'freshco', name: 'FreshCo', enabled: false, priceMatches: false },
      { id: 'food-basics', name: 'Food Basics', enabled: false, priceMatches: false },
      { id: 'walmart', name: 'Walmart', enabled: false, priceMatches: true },
    ],
    maxStores: 2,
    defaultBudget: 150,
    itemRules: [],
  };
}

export function newId(): string {
  return crypto.randomUUID();
}
