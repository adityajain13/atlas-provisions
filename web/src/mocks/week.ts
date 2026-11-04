import type { Day, Slot } from '@provisions/shared';

// ---- Week plan (mock) ----

export type MockTag = { kind: 'craving' | 'deal' | 'leftover'; text: string };

// A planned meal the household can rate. Only meals from a saved plan have one.
export type Rateable = {
  name: string;
  ingredientIds: string[];
  personIds: string[]; // real household members eating it
};

export type MockMeal = {
  slot: Slot;
  who: string;
  name: string;
  detail: string;
  cost: number | null;
  fixed?: boolean;
  tags: MockTag[];
  rateable?: Rateable;
};

export type MockDay = {
  key: Day;
  dayLabel: string;
  dateNum: number;
  headline: string;
  meals: MockMeal[];
};

export type MockWeek = {
  weekOf: string;
  label: string;
  budget: number;
  spent: number;
  stores: string[];
  days: MockDay[];
};

const yogurt: MockMeal = {
  slot: 'breakfast',
  who: 'You',
  name: 'Yogurt and granola',
  detail: 'Fixed weekday breakfast',
  cost: null,
  fixed: true,
  tags: [],
};

export const MOCK_WEEK: MockWeek = {
  weekOf: '2026-11-15',
  label: 'Sun Nov 15 – Sat Nov 21',
  budget: 150,
  spent: 131.4,
  stores: ['No Frills', 'FreshCo'],
  // Sunday first. Sunday is the shopping and prep day, so the roast chicken cooked then feeds Monday's lunch.
  days: [
    {
      key: 'sun',
      dayLabel: 'Sunday',
      dateNum: 15,
      headline: 'a roast chicken night.',
      meals: [
        {
          slot: 'breakfast',
          who: 'Both',
          name: 'Eggs and toast',
          detail: 'Eggs, sourdough, butter',
          cost: 3.0,
          tags: [],
        },
        {
          slot: 'lunch',
          who: 'You',
          name: 'Chickpea wrap',
          detail: 'Hummus, cucumber, spinach, tortilla',
          cost: 3.25,
          tags: [],
        },
        {
          slot: 'dinner',
          who: 'Both',
          name: 'Roast chicken with carrots',
          detail: 'Whole chicken, carrots, onion',
          cost: 17.95,
          tags: [{ kind: 'deal', text: 'Whole chicken $3.49/kg' }],
        },
      ],
    },
    {
      key: 'mon',
      dayLabel: 'Monday',
      dateNum: 16,
      headline: 'a red lentil dal, slowly.',
      meals: [
        { ...yogurt },
        {
          slot: 'lunch',
          who: 'You',
          name: 'Roast chicken wrap',
          detail: 'Packed from Sunday: chicken, romaine, parmesan',
          cost: null,
          tags: [{ kind: 'leftover', text: 'Leftover' }],
        },
        {
          slot: 'dinner',
          who: 'Both',
          name: 'Red lentil dal with rice',
          detail: 'Red lentils, tomato, ginger, spinach',
          cost: 6.2,
          tags: [{ kind: 'craving', text: 'Craving: comfort food' }],
        },
      ],
    },
    {
      key: 'tue',
      dayLabel: 'Tuesday',
      dateNum: 17,
      headline: 'a beef and broccoli stir-fry.',
      meals: [
        { ...yogurt },
        {
          slot: 'dinner',
          who: 'Both',
          name: 'Beef and broccoli stir-fry',
          detail: 'Flank steak, broccoli, rice',
          cost: 14.3,
          tags: [{ kind: 'deal', text: 'Broccoli 2 for $3 at FreshCo' }],
        },
      ],
    },
    {
      key: 'wed',
      dayLabel: 'Wednesday',
      dateNum: 18,
      headline: 'a leftovers-and-soup night.',
      meals: [
        { ...yogurt },
        {
          slot: 'lunch',
          who: 'You',
          name: 'Red lentil dal, leftover',
          detail: 'From Monday',
          cost: null,
          tags: [{ kind: 'leftover', text: 'Leftover' }],
        },
        {
          slot: 'dinner',
          who: 'You',
          name: 'Tomato soup and grilled cheese',
          detail: 'Canned tomatoes, cheddar, sourdough',
          cost: 5.4,
          tags: [],
        },
      ],
    },
    {
      key: 'thu',
      dayLabel: 'Thursday',
      dateNum: 19,
      headline: 'a butter chicken night.',
      meals: [
        { ...yogurt },
        {
          slot: 'lunch',
          who: 'You',
          name: 'Chicken caesar wrap',
          detail: 'Rotisserie chicken, romaine, parmesan',
          cost: 4.75,
          tags: [],
        },
        {
          slot: 'dinner',
          who: 'Both',
          name: 'Butter chicken with basmati',
          detail: 'Chicken thighs, tomato, cream, 2 cups rice',
          cost: 16.8,
          tags: [
            { kind: 'craving', text: 'Craving: butter chicken' },
            { kind: 'deal', text: 'Chicken thighs on sale at No Frills' },
          ],
        },
      ],
    },
    {
      key: 'fri',
      dayLabel: 'Friday',
      dateNum: 20,
      headline: 'a sheet-pan salmon night.',
      meals: [
        { ...yogurt },
        {
          slot: 'lunch',
          who: 'You',
          name: 'Leftover butter chicken',
          detail: 'Packed from Thursday',
          cost: null,
          tags: [{ kind: 'leftover', text: 'Leftover' }],
        },
        {
          slot: 'dinner',
          who: 'Both',
          name: 'Sheet-pan salmon and potatoes',
          detail: 'Salmon fillet, baby potatoes, green beans',
          cost: 18.4,
          tags: [{ kind: 'deal', text: 'Salmon at FreshCo, $7.99/lb' }],
        },
      ],
    },
    {
      key: 'sat',
      dayLabel: 'Saturday',
      dateNum: 21,
      headline: 'a slow-cooker chili, twice.',
      meals: [
        {
          slot: 'breakfast',
          who: 'Both',
          name: 'Pancakes',
          detail: 'Flour, eggs, milk, maple syrup',
          cost: 4.6,
          tags: [],
        },
        {
          slot: 'dinner',
          who: 'Both',
          name: 'Black bean chili',
          detail: 'Beans, ground beef, peppers, tomato',
          cost: 12.1,
          tags: [{ kind: 'craving', text: 'Craving: something hearty' }],
        },
      ],
    },
  ],
};

// ---- Shopping list (mock) ----

export const CATEGORY_ORDER = [
  'produce',
  'bakery',
  'meat & seafood',
  'deli',
  'dairy & eggs',
  'frozen',
  'pantry',
  'household',
] as const;
export type Category = (typeof CATEGORY_ORDER)[number];

export type MockItem = {
  id: string;
  store: string;
  category: Category;
  name: string;
  qty: string;
  price: number;
  note?: { kind: 'match' | 'used'; text: string };
};

export const MOCK_LIST: { weekOf: string; stores: string[]; items: MockItem[] } = {
  weekOf: MOCK_WEEK.weekOf,
  stores: ['No Frills', 'FreshCo'],
  items: [
    { id: 'bananas', store: 'No Frills', category: 'produce', name: 'Bananas', qty: '1 bunch', price: 1.49 },
    {
      id: 'whole-chicken',
      store: 'No Frills',
      category: 'meat & seafood',
      name: 'Whole chicken',
      qty: '1.6 kg',
      price: 5.58,
      note: { kind: 'used', text: 'Used in Sun roast chicken, Mon wrap' },
    },
    {
      id: 'spinach',
      store: 'No Frills',
      category: 'produce',
      name: 'Baby spinach',
      qty: '142 g',
      price: 2.49,
      note: { kind: 'used', text: 'Used in Sun wrap, Mon dal' },
    },
    {
      id: 'tomatoes',
      store: 'No Frills',
      category: 'produce',
      name: 'Roma tomatoes',
      qty: '1 kg',
      price: 2.99,
      note: { kind: 'used', text: 'Used in Thu butter chicken, Mon dal' },
    },
    { id: 'cilantro', store: 'No Frills', category: 'produce', name: 'Cilantro', qty: '1 bunch', price: 1.0 },
    {
      id: 'chicken-thighs',
      store: 'No Frills',
      category: 'meat & seafood',
      name: 'Boneless chicken thighs',
      qty: '1.5 kg',
      price: 11.99,
      note: { kind: 'match', text: 'Price-match FreshCo flyer: $1.99/lb' },
    },
    {
      id: 'ground-beef',
      store: 'No Frills',
      category: 'meat & seafood',
      name: 'Lean ground beef',
      qty: '500 g',
      price: 5.49,
      note: { kind: 'used', text: 'Used in Sat chili' },
    },
    { id: 'sourdough', store: 'No Frills', category: 'bakery', name: 'Sourdough loaf', qty: '1', price: 3.49 },
    { id: 'milk', store: 'No Frills', category: 'dairy & eggs', name: 'Milk 2%', qty: '2 L', price: 3.98 },
    { id: 'eggs', store: 'No Frills', category: 'dairy & eggs', name: 'Large eggs', qty: '18 count', price: 5.49 },
    { id: 'basmati', store: 'No Frills', category: 'pantry', name: 'Basmati rice', qty: '2 kg', price: 6.99 },
    { id: 'red-lentils', store: 'No Frills', category: 'pantry', name: 'Red lentils', qty: '900 g', price: 3.29 },
    {
      id: 'salmon',
      store: 'FreshCo',
      category: 'meat & seafood',
      name: 'Atlantic salmon fillet',
      qty: '700 g',
      price: 9.79,
      note: { kind: 'used', text: 'Used in Fri sheet-pan dinner' },
    },
    { id: 'broccoli', store: 'FreshCo', category: 'produce', name: 'Broccoli crowns', qty: '2 heads', price: 3.0 },
    { id: 'peas', store: 'FreshCo', category: 'frozen', name: 'Frozen peas', qty: '1 kg', price: 2.49 },
    { id: 'foil', store: 'FreshCo', category: 'household', name: 'Aluminum foil', qty: '1 roll', price: 4.29 },
  ],
};
