// Cuisines a household eats, and the staples each one keeps. Pure, so the Worker's planner and the web app agree on
// which foods a cuisine uses and how often a plan should lean on it.
import { INGREDIENT_BY_ID } from './catalog';

export const CUISINE_LEVELS = ['often', 'sometimes', 'rarely', 'never'] as const;
export type CuisineLevel = (typeof CUISINE_LEVELS)[number];

export const CUISINE_LEVEL_LABEL: Record<CuisineLevel, string> = {
  often: 'Often',
  sometimes: 'Sometimes',
  rarely: 'Rarely',
  never: 'Never',
};

export const CUISINE_GROUPS = ['South Asian', 'East Asian', 'Southeast Asian', 'Middle East', 'Americas', 'Europe', 'Africa'] as const;
export type CuisineGroup = (typeof CUISINE_GROUPS)[number];

export interface Cuisine {
  key: string; // stored in the household and on each meal
  label: string;
  group: CuisineGroup;
  pantry: string[]; // catalogue ids of the shelf-stable staples and spices the cuisine uses
  fresh: string[]; // catalogue ids of the key fresh and regular items the cuisine uses
}

/** The cuisines the household can rank. Order is the order the Household screen lists them in each group. */
export const CUISINES: Cuisine[] = [
  {
    key: 'indian',
    label: 'Indian',
    group: 'South Asian',
    pantry: ['garam-masala', 'turmeric', 'kashmiri-chili-powder', 'coriander-powder', 'cumin-seeds', 'mustard-seeds', 'fenugreek-seeds', 'cardamom', 'bay-leaves', 'ghee', 'ginger-garlic-paste', 'basmati-rice', 'chana-dal', 'toor-dal', 'besan', 'canned-diced-tomatoes'],
    fresh: ['paneer', 'green-chilies', 'cilantro', 'ginger', 'yellow-onion', 'curry-leaves', 'frozen-paratha', 'naan', 'potatoes', 'cauliflower', 'spinach', 'yogurt-plain'],
  },
  {
    key: 'indonesian',
    label: 'Indonesian',
    group: 'Southeast Asian',
    pantry: ['kecap-manis', 'sambal-oelek', 'shrimp-paste', 'coconut-milk', 'palm-sugar', 'jasmine-rice', 'soy-sauce', 'peanut-butter', 'lemongrass', 'galangal', 'tamarind-paste', 'vegetable-oil', 'garlic'],
    fresh: ['tempeh', 'tofu-firm', 'lemongrass', 'kaffir-lime-leaves', 'bean-sprouts', 'green-beans', 'mini-cucumbers', 'lemons', 'chicken-thigh-boneless'],
  },
  {
    key: 'hakka',
    label: 'Hakka (Indo-Chinese)',
    group: 'East Asian',
    pantry: ['indo-chinese-green-chili-sauce', 'soy-sauce', 'cornstarch', 'white-vinegar', 'hakka-noodles', 'sesame-oil', 'chili-garlic-sauce', 'hot-sauce', 'vegetable-oil', 'ketchup'],
    fresh: ['green-onions', 'red-bell-pepper', 'green-cabbage', 'carrots', 'garlic', 'ginger', 'green-bell-pepper', 'chicken-thigh-boneless', 'bok-choy'],
  },
  {
    key: 'italian',
    label: 'Italian',
    group: 'Europe',
    pantry: ['spaghetti', 'penne', 'pasta-sauce', 'canned-diced-tomatoes', 'san-marzano-tomatoes', 'tomato-passata', 'capers', 'anchovies', 'arborio-rice', 'orzo', 'olive-oil', 'balsamic-vinegar', 'pesto', 'lasagna-noodles', 'gnocchi', 'polenta', 'tomato-paste'],
    fresh: ['parmesan', 'mozzarella', 'ricotta', 'fresh-basil', 'garlic', 'yellow-onion', 'zucchini', 'roma-tomatoes', 'italian-sausage', 'prosciutto', 'pancetta', 'mascarpone', 'spinach'],
  },
  {
    key: 'chinese',
    label: 'Chinese',
    group: 'East Asian',
    pantry: ['soy-sauce', 'oyster-sauce', 'hoisin-sauce', 'shaoxing-wine', 'black-vinegar', 'cornstarch', 'sesame-oil', 'five-spice', 'sichuan-peppercorns', 'star-anise', 'rice-vinegar', 'jasmine-rice', 'egg-noodles', 'wonton-wrappers'],
    fresh: ['bok-choy', 'gai-lan', 'napa-cabbage', 'shiitake-mushrooms', 'bean-sprouts', 'ginger', 'green-onions', 'garlic', 'pork-belly', 'chicken-thigh-boneless', 'eggs-large'],
  },
  {
    key: 'korean',
    label: 'Korean',
    group: 'East Asian',
    pantry: ['gochujang', 'gochugaru', 'doenjang', 'soy-sauce', 'sesame-oil', 'sesame-seeds', 'rice-vinegar', 'sugar', 'glutinous-rice', 'sushi-rice', 'nori', 'mirin'],
    fresh: ['kimchi', 'green-onions', 'garlic', 'ginger', 'bean-sprouts', 'spinach', 'carrots', 'enoki-mushrooms', 'ground-beef', 'tofu-firm'],
  },
  {
    key: 'japanese',
    label: 'Japanese',
    group: 'East Asian',
    pantry: ['miso', 'mirin', 'cooking-sake', 'soy-sauce', 'dashi-powder', 'katsuobushi', 'sushi-rice', 'nori', 'udon-noodles', 'soba-noodles', 'rice-vinegar', 'sesame-seeds'],
    fresh: ['daikon', 'enoki-mushrooms', 'shiitake-mushrooms', 'green-onions', 'tofu-firm', 'salmon-fillet', 'english-cucumber', 'eggs-large', 'chicken-thigh-boneless'],
  },
  {
    key: 'taiwanese',
    label: 'Taiwanese',
    group: 'East Asian',
    pantry: ['soy-sauce', 'shaoxing-wine', 'five-spice', 'black-vinegar', 'cornstarch', 'sesame-oil', 'rice-vinegar', 'jasmine-rice', 'sugar', 'star-anise'],
    fresh: ['bok-choy', 'garlic', 'green-onions', 'ginger', 'pork-belly', 'shiitake-mushrooms', 'eggs-large', 'chicken-thigh-boneless'],
  },
  {
    key: 'thai',
    label: 'Thai',
    group: 'Southeast Asian',
    pantry: ['curry-paste-red', 'curry-paste-green', 'fish-sauce', 'coconut-milk', 'palm-sugar', 'jasmine-rice', 'rice-noodles', 'tamarind-paste', 'oyster-sauce', 'vegetable-oil', 'sambal-oelek'],
    fresh: ['thai-basil', 'thai-chilies', 'lemongrass', 'galangal', 'kaffir-lime-leaves', 'limes', 'bean-sprouts', 'chicken-thigh-boneless', 'tofu-firm', 'shrimp-raw'],
  },
  {
    key: 'vietnamese',
    label: 'Vietnamese',
    group: 'Southeast Asian',
    pantry: ['fish-sauce', 'rice-vinegar', 'rice-paper', 'rice-noodles', 'sugar', 'hoisin-sauce', 'hot-sauce', 'jasmine-rice', 'vegetable-oil', 'chili-garlic-sauce'],
    fresh: ['bean-sprouts', 'thai-basil', 'limes', 'carrots', 'mini-cucumbers', 'green-onions', 'lemongrass', 'chicken-thigh-boneless', 'shrimp-raw'],
  },
  {
    key: 'filipino',
    label: 'Filipino',
    group: 'Southeast Asian',
    pantry: ['cane-vinegar', 'soy-sauce', 'fish-sauce', 'sinigang-mix', 'jasmine-rice', 'vegetable-oil', 'bay-leaves', 'canned-diced-tomatoes', 'sugar'],
    fresh: ['garlic', 'yellow-onion', 'pork-belly', 'chicken-thigh-boneless', 'green-beans', 'bok-choy', 'eggplant', 'potatoes', 'ginger'],
  },
  {
    key: 'malaysian',
    label: 'Malaysian & Singaporean',
    group: 'Southeast Asian',
    pantry: ['curry-paste-red', 'coconut-milk', 'coconut-cream', 'kecap-manis', 'sambal-oelek', 'shrimp-paste', 'tamarind-paste', 'palm-sugar', 'jasmine-rice', 'rice-noodles', 'desiccated-coconut', 'soy-sauce'],
    fresh: ['lemongrass', 'galangal', 'pandan-leaves', 'shrimp-raw', 'tofu-firm', 'bean-sprouts', 'limes', 'chicken-thigh-boneless', 'eggs-large'],
  },
  {
    key: 'sri-lankan',
    label: 'Sri Lankan',
    group: 'South Asian',
    pantry: ['sri-lankan-curry-powder', 'coconut-milk', 'desiccated-coconut', 'mustard-seeds', 'curry-leaves', 'basmati-rice', 'red-chili-sauce', 'cinnamon', 'cardamom', 'tamarind-paste', 'dried-limes', 'lentils-red-dry'],
    fresh: ['curry-leaves', 'green-chilies', 'ginger', 'garlic', 'red-onion', 'lentils-red-dry', 'potatoes', 'eggplant', 'chicken-thigh-boneless', 'shrimp-raw'],
  },
  {
    key: 'pakistani',
    label: 'Pakistani',
    group: 'South Asian',
    pantry: ['garam-masala', 'turmeric', 'kashmiri-chili-powder', 'coriander-powder', 'cumin-seeds', 'ginger-garlic-paste', 'basmati-rice', 'chana-dal', 'besan', 'ghee', 'bay-leaves', 'cardamom', 'atta-flour'],
    fresh: ['yogurt-plain', 'green-chilies', 'cilantro', 'ginger', 'yellow-onion', 'potatoes', 'beef-stewing-cubes', 'lamb-shoulder', 'chicken-thigh-bone-in', 'frozen-chapati', 'tomato-paste'],
  },
  {
    key: 'middle-eastern',
    label: 'Middle Eastern',
    group: 'Middle East',
    pantry: ['tahini', 'za-atar', 'sumac', 'pomegranate-molasses', 'bulgur', 'couscous', 'cumin-seeds', 'cinnamon', 'olive-oil', 'chickpeas-canned', 'dried-limes', 'saffron', 'barberries', 'ground-cumin'],
    fresh: ['parsley', 'mint', 'cilantro', 'lemons', 'english-cucumber', 'roma-tomatoes', 'yellow-onion', 'pita', 'labneh', 'halloumi', 'lamb-shoulder', 'chicken-thigh-boneless'],
  },
  {
    key: 'persian',
    label: 'Persian',
    group: 'Middle East',
    pantry: ['saffron', 'barberries', 'basmati-rice', 'dried-limes', 'turmeric', 'cinnamon', 'sugar', 'olive-oil', 'chickpeas-dry', 'pomegranate-molasses', 'cardamom', 'dill'],
    fresh: ['dill', 'mint', 'parsley', 'cilantro', 'yellow-onion', 'lamb-shoulder', 'ground-lamb', 'chicken-thigh-bone-in', 'greek-yogurt', 'eggs-large', 'spinach'],
  },
  {
    key: 'mexican',
    label: 'Mexican',
    group: 'Americas',
    pantry: ['chipotle-in-adobo', 'masa-harina', 'refried-beans', 'black-beans-canned', 'corn-tortillas', 'salsa', 'ground-cumin', 'chili-powder', 'smoked-paprika', 'tortilla-chips', 'canned-corn', 'vegetable-oil'],
    fresh: ['jalapenos', 'limes', 'cilantro', 'queso-fresco', 'cotija', 'avocado', 'roma-tomatoes', 'yellow-onion', 'flour-tortillas', 'ground-beef', 'chicken-thigh-boneless'],
  },
  {
    key: 'caribbean',
    label: 'Caribbean',
    group: 'Americas',
    pantry: ['jerk-seasoning', 'allspice', 'coconut-milk', 'ackee', 'curry-powder', 'rice-noodles', 'kidney-beans-canned', 'brown-rice', 'vegetable-oil', 'sugar'],
    fresh: ['scotch-bonnet', 'plantains', 'sweet-potatoes', 'callaloo', 'limes', 'chicken-thigh-bone-in', 'green-onions', 'garlic', 'ginger', 'green-cabbage'],
  },
  {
    key: 'mediterranean',
    label: 'Greek & Mediterranean',
    group: 'Europe',
    pantry: ['feta', 'kalamata-olives', 'orzo', 'phyllo', 'olive-oil', 'dried-limes', 'capers', 'chickpeas-canned', 'tahini', 'couscous', 'balsamic-vinegar'],
    fresh: ['feta', 'greek-yogurt', 'lemons', 'english-cucumber', 'roma-tomatoes', 'parsley', 'dill', 'mint', 'chicken-thigh-boneless', 'eggplant', 'zucchini'],
  },
  {
    key: 'african',
    label: 'Ethiopian & West African',
    group: 'Africa',
    pantry: ['berbere', 'teff-flour', 'palm-oil', 'ground-cumin', 'whole-cloves', 'curry-powder', 'peanut-butter', 'tomato-paste', 'rice-noodles', 'vegetable-oil', 'ginger-garlic-paste'],
    fresh: ['yellow-onion', 'garlic', 'ginger', 'cassava', 'sweet-potatoes', 'green-chilies', 'chicken-thigh-bone-in', 'lentils-red-dry', 'kale', 'spinach'],
  },
];

/** The cuisine level a household gives each cuisine. Missing keys read as 'sometimes', except the four starter cuisines. */
export const DEFAULT_CUISINE_LEVELS: Record<string, CuisineLevel> = Object.fromEntries(
  CUISINES.map((c) => [c.key, ['indian', 'indonesian', 'hakka', 'italian'].includes(c.key) ? 'often' : 'sometimes']),
);

export function defaultCuisines(): Record<string, CuisineLevel> {
  return { ...DEFAULT_CUISINE_LEVELS };
}

/** The level a household gives a cuisine. A key the household has not stored reads as its default. */
export function cuisineLevel(levels: Record<string, CuisineLevel> | undefined, key: string): CuisineLevel {
  return levels?.[key] ?? DEFAULT_CUISINE_LEVELS[key] ?? 'sometimes';
}

/** The catalogue key, or undefined. Accepts the key or the label in any case, as the planner might write either. */
export function cuisineKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toLowerCase();
  const hit = CUISINES.find((c) => c.key === t || c.label.toLowerCase() === t);
  return hit?.key;
}

export function cuisineByKey(key: string): Cuisine | undefined {
  return CUISINES.find((c) => c.key === key);
}

/** The cuisines at each level, as keys in CUISINES order. The planner's payload. */
export function cuisineMixOf(levels: Record<string, CuisineLevel> | undefined): Record<CuisineLevel, string[]> {
  const mix: Record<CuisineLevel, string[]> = { often: [], sometimes: [], rarely: [], never: [] };
  for (const c of CUISINES) mix[cuisineLevel(levels, c.key)].push(c.key);
  return mix;
}

/**
 * Regular foods a household may use, as catalogue ids: the fresh and pantry staples of the cuisines it eats often,
 * then sometimes, each cuisine's fresh items before its pantry items. Rarely and never cuisines add nothing. Ids in
 * `exclude` are skipped (already on offer), and so are ids the caller rules out. At most `limit` come back.
 */
export function regularCandidates(
  levels: Record<string, CuisineLevel> | undefined,
  exclude: ReadonlySet<string>,
  limit = 40,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const level of ['often', 'sometimes'] as const) {
    for (const c of CUISINES) {
      if (cuisineLevel(levels, c.key) !== level) continue;
      for (const id of [...c.fresh, ...c.pantry]) {
        if (out.length >= limit) return out;
        if (seen.has(id) || exclude.has(id) || !INGREDIENT_BY_ID[id]) continue;
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/** The staples a new household starts with: common spices and condiments. The household changes the list from the Household screen. */
export const DEFAULT_ON_HAND: string[] = [
  'ground-cumin',
  'curry-powder',
  'garlic-powder',
  'smoked-paprika',
  'cinnamon',
  'soy-sauce',
  'dijon-mustard',
  'hot-sauce',
  'honey',
  'sugar',
];
