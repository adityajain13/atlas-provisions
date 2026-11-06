// Nutrition values are approximate (Canadian Nutrient File / USDA-style), to be refined.
// Per-100g values: raw for meats and produce, dry for grains and legumes, as sold.
// Cooking amounts (`cook`, below) are approximate typical weights and volumes: a cup of rice, an onion, a can. They
// only change how a meal reads (formatCookAmount in amounts.ts); quantities stay in base units everywhere else.

export type Category =
  | 'produce'
  | 'bakery'
  | 'meat'
  | 'seafood'
  | 'deli'
  | 'dairy'
  | 'frozen'
  | 'pantry'
  | 'household';

export const CATEGORY_ORDER: Category[] = [
  'produce',
  'bakery',
  'meat',
  'seafood',
  'deli',
  'dairy',
  'frozen',
  'pantry',
  'household',
];

export type BaseUnit = 'kg' | 'l' | 'each';

/** How a food is sold, for the households that keep only some forms (fresh, frozen, canned, dry). */
export type FoodForm = 'fresh' | 'frozen' | 'canned' | 'dry';
/** The groups of foods that share forms: a household chooses which forms of each group it keeps. */
export type FormGroupKey = 'fish' | 'beans' | 'vegetables' | 'tomatoes' | 'fruit';

/** The units a cook measures in. g and ml are plain weights and volumes. */
export type CookUnit =
  | 'cup'
  | 'tbsp'
  | 'tsp'
  | 'clove'
  | 'head'
  | 'bunch'
  | 'piece'
  | 'can'
  | 'slice'
  | 'fillet'
  | 'g'
  | 'ml';

/** How a cook counts an ingredient: one `unit` weighs `gramsPer` grams (or millilitres). Approximate. */
export interface CookAmount {
  unit: CookUnit;
  gramsPer?: number; // grams (or ml) in one unit; 1 for g and ml
  singular?: string; // the noun for one, when it is not the unit: 'onion' for a piece
  plural?: string; // the noun for more than one, when it is not singular + 's'
}

export interface Ingredient {
  id: string; // kebab slug, e.g. 'chicken-thigh-boneless'
  name: string; // 'Boneless chicken thighs'
  category: Category;
  baseUnit: BaseUnit; // unit prices are normalized to $/kg, $/l or $/each
  eachWeightKg?: number; // for 'each' items, approximate weight of one as sold (for nutrition)
  eachLabel?: string; // for 'each' items, what one counts as, e.g. 'one loaf'
  nutritionPer100g: { kcal: number; protein: number; carbs: number; fat: number; fibre: number };
  allergens: string[]; // subset of ALLERGEN_PRESETS from shared index
  shelfLifeDays: number;
  vegetarian: boolean;
  protein?:
    | 'chicken'
    | 'beef'
    | 'pork'
    | 'turkey'
    | 'fish'
    | 'seafood'
    | 'egg'
    | 'tofu'
    | 'legume'
    | 'dairy';
  aliases: string[]; // lowercase keywords/phrases that identify it in flyer text
  form?: FoodForm; // where meaningful: the form this entry is sold in
  formGroup?: FormGroupKey; // the group of foods this form choice belongs to
  cook?: CookAmount; // how a cook measures it, where that reads better than grams
}

type Nut =[kcal: number, protein: number, carbs: number, fat: number, fibre: number];

interface Extra {
  allergens?: string[];
  protein?: Ingredient['protein'];
  eachWeightKg?: number;
  eachLabel?: string;
  form?: FoodForm;
  formGroup?: FormGroupKey;
}

function ing(
  id: string,
  name: string,
  category: Category,
  baseUnit: BaseUnit,
  nut: Nut,
  shelfLifeDays: number,
  vegetarian: boolean,
  aliases: string[],
  extra: Extra = {},
): Ingredient {
  const [kcal, protein, carbs, fat, fibre] = nut;
  const out: Ingredient = {
    id,
    name,
    category,
    baseUnit,
    nutritionPer100g: { kcal, protein, carbs, fat, fibre },
    allergens: extra.allergens ?? [],
    shelfLifeDays,
    vegetarian,
    aliases,
  };
  if (extra.eachWeightKg !== undefined) out.eachWeightKg = extra.eachWeightKg;
  if (extra.eachLabel !== undefined) out.eachLabel = extra.eachLabel;
  if (extra.protein !== undefined) out.protein = extra.protein;
  if (extra.form !== undefined) out.form = extra.form;
  if (extra.formGroup !== undefined) out.formGroup = extra.formGroup;
  return out;
}

const meat: Ingredient[] = [
  ing('chicken-thigh-boneless', 'Boneless chicken thighs', 'meat', 'kg', [177, 19.3, 0, 10.9, 0], 2, false,
    ['chicken thigh', 'chicken thighs', 'boneless skinless chicken thighs', 'bnls chkn thgh', 'boneless chicken thighs', 'bnls chicken thigh'],
    { protein: 'chicken' }),
  ing('chicken-thigh-bone-in', 'Bone-in chicken thighs', 'meat', 'kg', [179, 18.6, 0, 11.4, 0], 2, false,
    ['bone-in chicken thighs', 'bone in chicken thighs', 'bone-in chicken thigh', 'bone in chicken thigh'],
    { protein: 'chicken' }),
  ing('chicken-breast-boneless', 'Boneless chicken breasts', 'meat', 'kg', [120, 22.5, 0, 2.6, 0], 2, false,
    ['chicken breast', 'chicken breasts', 'boneless skinless chicken breast', 'boneless chicken breast', 'bnls chkn brst', 'boneless chicken breasts'],
    { protein: 'chicken' }),
  ing('chicken-breast-bone-in', 'Bone-in chicken breasts', 'meat', 'kg', [170, 20.5, 0, 9.4, 0], 2, false,
    ['bone-in chicken breast', 'bone in chicken breast', 'bone-in chicken breasts', 'bone in chicken breasts'],
    { protein: 'chicken' }),
  ing('chicken-drumsticks', 'Chicken drumsticks', 'meat', 'kg', [172, 18.4, 0, 10.5, 0], 2, false,
    ['chicken drumsticks', 'chicken drumstick', 'drumsticks', 'chkn drumstick', 'chicken legs'],
    { protein: 'chicken' }),
  ing('whole-chicken', 'Whole chicken', 'meat', 'kg', [190, 17.7, 0, 13.3, 0], 2, false,
    ['whole chicken', 'whole roasting chicken', 'whole chkn', 'roasting chicken'],
    { protein: 'chicken' }),
  ing('ground-beef', 'Ground beef', 'meat', 'kg', [250, 17.2, 0, 20, 0], 2, false,
    ['ground beef', 'lean ground beef', 'beef mince', 'minced beef', 'ground round', 'gr beef'],
    { protein: 'beef' }),
  ing('ground-turkey', 'Ground turkey', 'meat', 'kg', [189, 20.1, 0, 11.5, 0], 2, false,
    ['ground turkey', 'turkey mince', 'lean ground turkey', 'gr turkey'],
    { protein: 'turkey' }),
  ing('ground-pork', 'Ground pork', 'meat', 'kg', [263, 16.9, 0, 21.2, 0], 2, false,
    ['ground pork', 'pork mince', 'minced pork'],
    { protein: 'pork' }),
  ing('pork-chops', 'Pork chops', 'meat', 'kg', [195, 20.9, 0, 12.1, 0], 3, false,
    ['pork chops', 'pork chop', 'bone-in pork chops', 'boneless pork chops', 'bnls pork chop', 'combo chops', 'pork loin chops'],
    { protein: 'pork' }),
  ing('pork-tenderloin', 'Pork tenderloin', 'meat', 'kg', [143, 26.6, 0, 3.5, 0], 3, false,
    ['pork tenderloin', 'pork loin tenderloin', 'pork tenderloins'],
    { protein: 'pork' }),
  ing('italian-sausage', 'Italian sausage', 'meat', 'kg', [301, 14.3, 2.0, 26.5, 0], 3, false,
    ['italian sausage', 'italian sausages', 'sweet italian sausage', 'hot italian sausage', 'pork sausage'],
    { protein: 'pork' }),
  ing('beef-stewing-cubes', 'Beef stewing cubes', 'meat', 'kg', [158, 21.8, 0, 7.3, 0], 3, false,
    ['stewing beef', 'beef stew meat', 'stew beef', 'beef stewing cubes', 'beef cubes'],
    { protein: 'beef' }),
  ing('sirloin-steak', 'Sirloin steak', 'meat', 'kg', [170, 21.5, 0, 9.0, 0], 3, false,
    ['sirloin steak', 'sirloin', 'beef sirloin', 'top sirloin'],
    { protein: 'beef' }),
  ing('turkey-breast-deli', 'Turkey breast roast', 'meat', 'kg', [106, 22.4, 0.6, 1.0, 0], 3, false,
    ['turkey breast', 'turkey breast roast', 'boneless turkey breast'],
    { protein: 'turkey' }),
];

const seafood: Ingredient[] = [
  ing('salmon-fillet', 'Salmon fillet', 'seafood', 'kg', [208, 20.4, 0, 13.4, 0], 2, false,
    ['salmon', 'salmon fillet', 'salmon fillets', 'atlantic salmon', 'sockeye salmon', 'coho salmon'],
    { allergens: ['fish'], protein: 'fish', form: 'fresh', formGroup: 'fish' }),
  ing('tilapia-fillet', 'Tilapia fillets', 'seafood', 'kg', [96, 20.1, 0, 1.7, 0], 2, false,
    ['tilapia', 'tilapia fillet', 'tilapia fillets'],
    { allergens: ['fish'], protein: 'fish', form: 'fresh', formGroup: 'fish' }),
  ing('cod-fillet', 'Cod fillets', 'seafood', 'kg', [82, 17.8, 0, 0.7, 0], 2, false,
    ['cod', 'cod fillet', 'cod fillets', 'atlantic cod'],
    { allergens: ['fish'], protein: 'fish', form: 'fresh', formGroup: 'fish' }),
  ing('shrimp-raw', 'Shrimp', 'seafood', 'kg', [85, 20.1, 0, 0.5, 0], 2, false,
    ['shrimp', 'raw shrimp', 'large shrimp', 'shrimp tail on', 'peeled shrimp', 'uncooked shrimp'],
    { allergens: ['shellfish'], protein: 'seafood', form: 'fresh', formGroup: 'fish' }),
  ing('canned-tuna', 'Canned tuna (light, in water)', 'seafood', 'each', [116, 25.5, 0, 0.8, 0], 1095, false,
    ['tuna', 'canned tuna', 'light tuna', 'chunk light tuna', 'tuna in water', 'chunk tuna'],
    { allergens: ['fish'], protein: 'fish', eachWeightKg: 0.142, eachLabel: 'one can', form: 'canned', formGroup: 'fish' }),
  ing('canned-salmon', 'Canned salmon', 'seafood', 'each', [142, 19.8, 0, 6.3, 0], 1095, false,
    ['canned salmon', 'pink salmon', 'sockeye salmon can'],
    { allergens: ['fish'], protein: 'fish', eachWeightKg: 0.213, form: 'canned', formGroup: 'fish' }),
];

const proteinsOther: Ingredient[] = [
  ing('eggs-large', 'Large eggs', 'dairy', 'each', [143, 12.6, 0.7, 9.5, 0], 35, true,
    ['eggs', 'large eggs', 'egg', 'dozen eggs', 'eggs large', 'grade a eggs'],
    { allergens: ['egg'], protein: 'egg', eachWeightKg: 0.7, eachLabel: 'one dozen carton' }),
  ing('tofu-firm', 'Firm tofu', 'pantry', 'kg', [144, 15.8, 2.8, 8.7, 2.3], 14, true,
    ['firm tofu', 'tofu', 'extra firm tofu', 'extra-firm tofu', 'tofu firm', 'organic tofu'],
    { allergens: ['soy'], protein: 'tofu' }),
  ing('chickpeas-dry', 'Dry chickpeas', 'pantry', 'kg', [364, 19.3, 61, 6.0, 17.4], 365, true,
    ['dry chickpeas', 'dried chickpeas', 'chickpeas dry', 'chickpeas', 'garbanzo beans'],
    { protein: 'legume', form: 'dry', formGroup: 'beans' }),
  ing('lentils-red-dry', 'Red lentils (dry)', 'pantry', 'kg', [358, 25.8, 60, 1.1, 10.7], 365, true,
    ['red lentils', 'dry red lentils', 'split red lentils', 'lentils', 'red lentil'],
    { protein: 'legume', form: 'dry', formGroup: 'beans' }),
  ing('black-beans-dry', 'Dry black beans', 'pantry', 'kg', [341, 21.6, 62.4, 1.4, 15.5], 365, true,
    ['dry black beans', 'dried black beans', 'black beans dry', 'black turtle beans'],
    { protein: 'legume', form: 'dry', formGroup: 'beans' }),
  ing('chickpeas-canned', 'Canned chickpeas', 'pantry', 'each', [139, 7.1, 22.5, 2.1, 6.1], 730, true,
    ['canned chickpeas', 'chickpeas can', 'chickpeas 540 ml', 'chick peas', 'canned garbanzo beans'],
    { protein: 'legume', eachWeightKg: 0.425, form: 'canned', formGroup: 'beans' }),
  ing('black-beans-canned', 'Canned black beans', 'pantry', 'each', [132, 8.9, 23.7, 0.5, 8.7], 730, true,
    ['canned black beans', 'black beans can', 'black beans 540 ml', 'black beans'],
    { protein: 'legume', eachWeightKg: 0.398, form: 'canned', formGroup: 'beans' }),
  ing('lentils-canned', 'Canned lentils', 'pantry', 'each', [116, 9.0, 20.1, 0.4, 7.9], 730, true,
    ['canned lentils', 'lentils can', 'lentils 540 ml'],
    { protein: 'legume', eachWeightKg: 0.398, form: 'canned', formGroup: 'beans' }),
  ing('kidney-beans-canned', 'Canned kidney beans', 'pantry', 'each', [127, 8.7, 22.8, 0.5, 6.4], 730, true,
    ['canned kidney beans', 'kidney beans', 'red kidney beans'],
    { protein: 'legume', eachWeightKg: 0.398, form: 'canned', formGroup: 'beans' }),
  ing('pinto-beans-canned', 'Canned pinto beans', 'pantry', 'each', [143, 9.0, 26.2, 0.6, 9.0], 730, true,
    ['canned pinto beans', 'pinto beans'],
    { protein: 'legume', eachWeightKg: 0.398, form: 'canned', formGroup: 'beans' }),
];

const produce: Ingredient[] = [
  ing('broccoli', 'Broccoli', 'produce', 'kg', [34, 2.8, 6.6, 0.4, 2.6], 7, true, ['broccoli', 'broccoli crowns', 'broccoli florets'], { form: 'fresh', formGroup: 'vegetables' }),
  ing('baby-carrots', 'Baby carrots', 'produce', 'kg', [41, 0.9, 9.6, 0.2, 2.8], 21, true, ['baby carrots', 'baby carrot', 'bnls carrots', 'mini carrots']),
  ing('carrots', 'Carrots', 'produce', 'kg', [41, 0.9, 9.6, 0.2, 2.8], 21, true, ['carrots', 'carrot', 'bulk carrots', 'carrots 2 lb', 'bagged carrots', 'carrots bag']),
  ing('mini-cucumbers', 'Mini cucumbers', 'produce', 'kg', [15, 0.7, 3.6, 0.1, 0.5], 7, true, ['mini cucumbers', 'mini cucumber', 'snacking cucumbers', 'mini cukes']),
  ing('english-cucumber', 'English cucumber', 'produce', 'each', [15, 0.7, 3.6, 0.1, 0.5], 7, true, ['english cucumber', 'seedless cucumber', 'long english cucumber'], { eachWeightKg: 0.35 }),
  ing('grapes-red', 'Red seedless grapes', 'produce', 'kg', [69, 0.7, 18.1, 0.2, 0.9], 7, true, ['red grapes', 'red seedless grapes', 'grapes red', 'grapes', 'seedless grapes'], { form: 'fresh', formGroup: 'fruit' }),
  ing('grapes-green', 'Green seedless grapes', 'produce', 'kg', [69, 0.7, 18.1, 0.2, 0.9], 7, true, ['green grapes', 'green seedless grapes', 'grapes green'], { form: 'fresh', formGroup: 'fruit' }),
  ing('spinach', 'Spinach', 'produce', 'kg', [23, 2.9, 3.6, 0.4, 2.2], 5, true, ['spinach', 'baby spinach', 'spinach bunch', 'bunch spinach', 'fresh spinach'], { form: 'fresh', formGroup: 'vegetables' }),
  ing('red-bell-pepper', 'Red bell peppers', 'produce', 'each', [31, 1.0, 6.0, 0.3, 2.1], 10, true, ['red bell pepper', 'red bell peppers', 'red peppers', 'red sweet pepper'], { eachWeightKg: 0.165 }),
  ing('green-bell-pepper', 'Green bell peppers', 'produce', 'each', [20, 0.9, 4.6, 0.2, 1.7], 10, true, ['green bell pepper', 'green bell peppers', 'green peppers', 'green sweet pepper', 'bell peppers', 'bell pepper'], { eachWeightKg: 0.16 }),
  ing('yellow-onion', 'Yellow onions', 'produce', 'kg', [40, 1.1, 9.3, 0.1, 1.7], 30, true, ['yellow onion', 'yellow onions', 'onions', 'onion', 'cooking onions']),
  ing('red-onion', 'Red onions', 'produce', 'kg', [40, 1.1, 9.3, 0.1, 1.7], 30, true, ['red onion', 'red onions', 'purple onion']),
  ing('green-onions', 'Green onions', 'produce', 'each', [32, 1.8, 7.3, 0.2, 2.6], 10, true, ['green onions', 'green onion', 'scallions', 'scallion', 'spring onions'], { eachWeightKg: 0.015 }),
  ing('garlic', 'Garlic', 'produce', 'kg', [149, 6.4, 33.1, 0.5, 2.1], 60, true, ['garlic', 'garlic bulb', 'garlic bulbs', 'head of garlic']),
  ing('potatoes', 'Potatoes', 'produce', 'kg', [77, 2.0, 17.5, 0.1, 2.2], 30, true, ['potatoes', 'potato', 'white potatoes', 'yellow potatoes', 'russet potatoes', 'baking potatoes', 'gold potatoes']),
  ing('sweet-potatoes', 'Sweet potatoes', 'produce', 'kg', [86, 1.6, 20.1, 0.1, 3.0], 30, true, ['sweet potatoes', 'sweet potato', 'yams']),
  ing('roma-tomatoes', 'Roma tomatoes', 'produce', 'kg', [18, 0.9, 3.9, 0.2, 1.2], 7, true, ['roma tomatoes', 'roma tomato', 'plum tomatoes', 'tomatoes', 'tomato'], { form: 'fresh', formGroup: 'tomatoes' }),
  ing('cherry-tomatoes', 'Cherry tomatoes', 'produce', 'kg', [18, 0.9, 3.9, 0.2, 1.2], 7, true, ['cherry tomatoes', 'grape tomatoes', 'cherry tomato', 'snack tomatoes'], { form: 'fresh', formGroup: 'tomatoes' }),
  ing('bananas', 'Bananas', 'produce', 'kg', [89, 1.1, 22.8, 0.3, 2.6], 7, true, ['bananas', 'banana', 'bananas bunch'], { form: 'fresh', formGroup: 'fruit' }),
  ing('gala-apples', 'Gala apples', 'produce', 'kg', [52, 0.3, 13.8, 0.2, 2.4], 30, true, ['gala apples', 'gala apple', 'apples', 'apple', 'royal gala'], { form: 'fresh', formGroup: 'fruit' }),
  ing('navel-oranges', 'Navel oranges', 'produce', 'each', [47, 0.9, 11.8, 0.1, 2.4], 21, true, ['navel oranges', 'oranges', 'orange', 'navel orange', 'valencia oranges'], { eachWeightKg: 0.15, form: 'fresh', formGroup: 'fruit' }),
  ing('strawberries', 'Strawberries', 'produce', 'kg', [32, 0.7, 7.7, 0.3, 2.0], 5, true, ['strawberries', 'strawberry', 'fresh strawberries'], { form: 'fresh', formGroup: 'fruit' }),
  ing('blueberries', 'Blueberries', 'produce', 'kg', [57, 0.7, 14.5, 0.3, 2.4], 7, true, ['blueberries', 'blueberry', 'fresh blueberries'], { form: 'fresh', formGroup: 'fruit' }),
  ing('raspberries', 'Raspberries', 'produce', 'kg', [52, 1.2, 11.9, 0.7, 6.5], 3, true, ['raspberries', 'raspberry', 'fresh raspberries'], { form: 'fresh', formGroup: 'fruit' }),
  ing('avocado', 'Avocados', 'produce', 'each', [160, 2.0, 8.5, 14.7, 6.7], 7, true, ['avocado', 'avocados', 'hass avocado', 'hass avocados'], { eachWeightKg: 0.2 }),
  ing('lemons', 'Lemons', 'produce', 'each', [29, 1.1, 9.3, 0.3, 2.8], 28, true, ['lemons', 'lemon', 'lemon each'], { eachWeightKg: 0.1 }),
  ing('limes', 'Limes', 'produce', 'each', [30, 0.7, 10.5, 0.2, 2.8], 28, true, ['limes', 'lime', 'limes each'], { eachWeightKg: 0.07 }),
  ing('cilantro', 'Cilantro', 'produce', 'each', [23, 2.1, 3.7, 0.5, 2.8], 7, true, ['cilantro', 'fresh cilantro', 'coriander leaves', 'cilantro bunch'], { eachWeightKg: 0.05 }),
  ing('parsley', 'Parsley', 'produce', 'each', [36, 3.0, 6.3, 0.8, 3.3], 7, true, ['parsley', 'fresh parsley', 'flat leaf parsley', 'italian parsley'], { eachWeightKg: 0.05 }),
  ing('ginger', 'Ginger root', 'produce', 'kg', [80, 1.8, 17.8, 0.8, 2.0], 21, true, ['ginger', 'ginger root', 'fresh ginger', 'ginger knob']),
  ing('white-mushrooms', 'White mushrooms', 'produce', 'kg', [22, 3.1, 3.3, 0.3, 1.0], 7, true, ['mushrooms', 'white mushrooms', 'button mushrooms', 'mushroom', 'sliced mushrooms']),
  ing('zucchini', 'Zucchini', 'produce', 'kg', [17, 1.2, 3.1, 0.3, 1.0], 7, true, ['zucchini', 'zucchinis', 'courgette', 'green squash']),
  ing('cauliflower', 'Cauliflower', 'produce', 'each', [25, 1.9, 5.0, 0.3, 2.0], 14, true, ['cauliflower', 'cauliflower head', 'whole cauliflower'], { eachWeightKg: 0.6 }),
  ing('green-cabbage', 'Green cabbage', 'produce', 'each', [25, 1.3, 5.8, 0.1, 2.5], 21, true, ['cabbage', 'green cabbage', 'cabbage head', 'green cabbages'], { eachWeightKg: 0.9 }),
  ing('romaine-lettuce', 'Romaine lettuce', 'produce', 'each', [17, 1.2, 3.3, 0.3, 2.1], 7, true, ['romaine', 'romaine lettuce', 'romaine hearts', 'romaine heart', 'lettuce'], { eachWeightKg: 0.45 }),
  ing('kale', 'Kale', 'produce', 'kg', [49, 4.3, 8.8, 0.9, 3.6], 7, true, ['kale', 'curly kale', 'lacinato kale', 'kale bunch']),
  ing('green-beans', 'Green beans', 'produce', 'kg', [31, 1.8, 7.0, 0.2, 2.7], 7, true, ['green beans', 'green bean', 'string beans', 'fresh green beans'], { form: 'fresh', formGroup: 'vegetables' }),
  ing('corn-cobs', 'Corn on the cob', 'produce', 'each', [86, 3.3, 18.7, 1.4, 2.7], 5, true, ['corn', 'corn on the cob', 'corn cobs', 'sweet corn', 'corn cob'], { eachWeightKg: 0.2, form: 'fresh', formGroup: 'vegetables' }),
  ing('celery', 'Celery', 'produce', 'kg', [16, 0.7, 3.0, 0.2, 1.6], 14, true, ['celery', 'celery stalks', 'celery bunch']),
  ing('asparagus', 'Asparagus', 'produce', 'kg', [20, 2.2, 3.9, 0.1, 2.1], 5, true, ['asparagus', 'asparagus bunch', 'fresh asparagus']),
  ing('pears', 'Pears', 'produce', 'kg', [57, 0.4, 15.2, 0.1, 3.1], 21, true, ['pears', 'pear', 'bartlett pears', 'bosc pears'], { form: 'fresh', formGroup: 'fruit' }),
  ing('mangoes', 'Mangoes', 'produce', 'each', [60, 0.8, 15.0, 0.4, 1.6], 7, true, ['mango', 'mangoes', 'mangos', 'ataulfo mango'], { eachWeightKg: 0.3, form: 'fresh', formGroup: 'fruit' }),
  ing('pineapple', 'Pineapple', 'produce', 'each', [50, 0.5, 13.1, 0.1, 1.4], 7, true, ['pineapple', 'pineapples', 'whole pineapple'], { eachWeightKg: 1.2, form: 'fresh', formGroup: 'fruit' }),
  ing('jalapenos', 'Jalapeño peppers', 'produce', 'kg', [29, 0.9, 6.5, 0.4, 2.8], 14, true, ['jalapeno', 'jalapenos', 'jalapeño', 'jalapeños', 'jalapeno peppers']),
  ing('eggplant', 'Eggplant', 'produce', 'each', [25, 1.0, 5.9, 0.2, 3.0], 7, true, ['eggplant', 'eggplants', 'aubergine', 'globe eggplant'], { eachWeightKg: 0.3 }),
  ing('butternut-squash', 'Butternut squash', 'produce', 'kg', [45, 1.0, 11.7, 0.1, 2.0], 60, true, ['butternut squash', 'butternut', 'squash', 'butternut squash whole']),
];

const dairy: Ingredient[] = [
  ing('milk-2-percent', 'Milk 2%', 'dairy', 'l', [50, 3.4, 4.8, 2.0, 0], 10, true, ['milk', '2% milk', '2 % milk', 'milk 2%', 'homo milk', 'skim milk', '1% milk'], { allergens: ['dairy'] }),
  ing('greek-yogurt', 'Greek yogurt (plain)', 'dairy', 'kg', [97, 9.0, 3.9, 5.0, 0], 21, true, ['greek yogurt', 'greek yoghurt', 'plain greek yogurt', 'balkan style yogurt'], { allergens: ['dairy'], protein: 'dairy' }),
  ing('yogurt-plain', 'Plain yogurt', 'dairy', 'kg', [61, 3.5, 4.7, 3.3, 0], 21, true, ['yogurt', 'plain yogurt', 'vanilla yogurt', 'yoghurt'], { allergens: ['dairy'] }),
  ing('cheddar', 'Cheddar cheese', 'dairy', 'kg', [403, 25.0, 1.3, 33.1, 0], 60, true, ['cheddar', 'cheddar cheese', 'old cheddar', 'marble cheddar', 'shredded cheddar'], { allergens: ['dairy'] }),
  ing('mozzarella', 'Mozzarella', 'dairy', 'kg', [280, 27.9, 2.2, 17.1, 0], 21, true, ['mozzarella', 'mozzarella cheese', 'shredded mozzarella', 'part skim mozzarella'], { allergens: ['dairy'] }),
  ing('paneer', 'Paneer', 'dairy', 'kg', [321, 21.4, 3.6, 25.0, 0], 14, true, ['paneer', 'paneer cheese', 'fresh paneer'], { allergens: ['dairy'], protein: 'dairy' }),
  ing('butter', 'Butter', 'dairy', 'kg', [717, 0.9, 0.1, 81.1, 0], 60, true, ['butter', 'unsalted butter', 'salted butter'], { allergens: ['dairy'] }),
  ing('whipping-cream', 'Whipping cream', 'dairy', 'l', [340, 2.1, 2.8, 36.1, 0], 14, true, ['whipping cream', 'table cream', 'cooking cream', 'heavy cream', 'whipping cream 35%'], { allergens: ['dairy'] }),
  ing('cream-cheese', 'Cream cheese', 'dairy', 'kg', [342, 5.9, 4.1, 34.2, 0], 21, true, ['cream cheese', 'philadelphia cream cheese', 'block cream cheese'], { allergens: ['dairy'] }),
  ing('sour-cream', 'Sour cream', 'dairy', 'kg', [198, 2.4, 4.6, 19.4, 0], 21, true, ['sour cream', 'light sour cream'], { allergens: ['dairy'] }),
];

const bakery: Ingredient[] = [
  ing('white-bread', 'White bread', 'bakery', 'each', [265, 9.0, 49.0, 3.2, 2.4], 7, true, ['white bread', 'sandwich bread', 'bread loaf', 'bread', 'loaf of bread'], { allergens: ['gluten'], eachWeightKg: 0.675, eachLabel: 'one loaf' }),
  ing('whole-wheat-bread', 'Whole wheat bread', 'bakery', 'each', [247, 13.0, 41.0, 3.4, 6.9], 7, true, ['whole wheat bread', 'whole grain bread', 'wholewheat bread', 'multigrain bread'], { allergens: ['gluten'], eachWeightKg: 0.675, eachLabel: 'one loaf' }),
  ing('flour-tortillas', 'Flour tortillas', 'bakery', 'each', [312, 8.2, 52.0, 7.7, 2.4], 14, true, ['flour tortillas', 'flour tortilla', 'tortillas', 'soft tortillas', 'wraps', 'large tortillas'], { allergens: ['gluten'], eachWeightKg: 0.6, eachLabel: 'one pack of tortillas' }),
  ing('corn-tortillas', 'Corn tortillas', 'bakery', 'each', [218, 5.7, 44.6, 2.9, 6.3], 14, true, ['corn tortillas', 'corn tortilla', 'soft corn tortillas'], { eachWeightKg: 0.3, eachLabel: 'one pack of tortillas' }),
  ing('naan', 'Naan', 'bakery', 'each', [262, 8.7, 45.2, 5.1, 2.2], 7, true, ['naan', 'naan bread', 'garlic naan', 'plain naan'], { allergens: ['gluten', 'dairy'], eachWeightKg: 0.1 }),
  ing('pita', 'Pita bread', 'bakery', 'each', [275, 9.1, 55.7, 1.2, 2.2], 7, true, ['pita', 'pita bread', 'pitas', 'whole wheat pita', 'pocket pita'], { allergens: ['gluten'], eachWeightKg: 0.36, eachLabel: 'one pack of pita' }),
  ing('bagels', 'Bagels', 'bakery', 'each', [257, 10.0, 50.0, 1.5, 2.0], 5, true, ['bagels', 'bagel', 'plain bagels', 'everything bagels'], { allergens: ['gluten'], eachWeightKg: 0.1 }),
];

const deli: Ingredient[] = [
  ing('deli-ham', 'Deli ham', 'deli', 'kg', [107, 17.5, 1.5, 3.2, 0], 7, false, ['ham', 'deli ham', 'sliced ham', 'shaved ham', 'black forest ham'], { protein: 'pork' }),
  ing('hummus', 'Hummus', 'deli', 'kg', [166, 7.9, 14.3, 9.6, 6.0], 7, true, ['hummus', 'classic hummus', 'roasted red pepper hummus', 'garlic hummus'], { allergens: ['sesame'] }),
  ing('deli-turkey', 'Sliced deli turkey', 'deli', 'kg', [104, 17.1, 2.6, 2.0, 0], 5, false, ['deli turkey', 'sliced turkey', 'shaved turkey', 'oven roasted turkey'], { protein: 'turkey' }),
  ing('pepperoni', 'Pepperoni', 'deli', 'kg', [494, 22.7, 1.3, 44.0, 0], 30, false, ['pepperoni', 'sliced pepperoni', 'pizza pepperoni'], { protein: 'pork' }),
  ing('rotisserie-chicken', 'Rotisserie chicken', 'deli', 'each', [190, 17.7, 0, 13.3, 0], 4, false, ['rotisserie chicken', 'rotisserie chkn', 'cooked whole chicken', 'roast chicken'], { protein: 'chicken', eachWeightKg: 1.1 }),
];

const frozen: Ingredient[] = [
  ing('frozen-peas', 'Frozen peas', 'frozen', 'kg', [81, 5.4, 14.5, 0.4, 5.1], 365, true, ['frozen peas', 'frozen green peas', 'peas', 'green peas'], { form: 'frozen', formGroup: 'vegetables' }),
  ing('frozen-mixed-veg', 'Frozen mixed vegetables', 'frozen', 'kg', [65, 3.0, 13.0, 0.3, 4.0], 365, true, ['frozen mixed veg', 'frozen mixed vegetables', 'mixed vegetables', 'mixed veg', 'stir fry veg'], { form: 'frozen', formGroup: 'vegetables' }),
  ing('frozen-berries', 'Frozen mixed berries', 'frozen', 'kg', [50, 0.7, 12.0, 0.3, 3.5], 365, true, ['frozen berries', 'frozen mixed berries', 'frozen mixed berry', 'frozen strawberries', 'frozen blueberries'], { form: 'frozen', formGroup: 'fruit' }),
  ing('edamame-frozen', 'Frozen shelled edamame', 'frozen', 'kg', [121, 11.9, 8.9, 5.2, 5.2], 365, true, ['edamame', 'frozen edamame', 'shelled edamame'], { allergens: ['soy'], protein: 'legume' }),
  ing('frozen-broccoli', 'Frozen broccoli', 'frozen', 'kg', [35, 2.4, 6.6, 0.4, 3.3], 365, true, ['frozen broccoli', 'broccoli florets frozen', 'frozen broccoli florets'], { form: 'frozen', formGroup: 'vegetables' }),
  ing('frozen-corn', 'Frozen corn', 'frozen', 'kg', [86, 3.2, 19.0, 1.2, 2.7], 365, true, ['frozen corn', 'frozen sweet corn', 'corn kernels frozen'], { form: 'frozen', formGroup: 'vegetables' }),
  ing('frozen-spinach', 'Frozen spinach', 'frozen', 'kg', [23, 2.9, 3.6, 0.3, 2.2], 365, true, ['frozen spinach', 'chopped frozen spinach'], { form: 'frozen', formGroup: 'vegetables' }),
  ing('frozen-shrimp', 'Frozen shrimp', 'frozen', 'kg', [85, 20.1, 0, 0.5, 0], 365, false, ['frozen shrimp', 'frozen raw shrimp', 'frozen large shrimp'], { allergens: ['shellfish'], protein: 'seafood', form: 'frozen', formGroup: 'fish' }),
  ing('ice-cream', 'Ice cream', 'frozen', 'l', [207, 3.5, 24.0, 11.0, 0.7], 60, true, ['ice cream', 'vanilla ice cream', 'chocolate ice cream'], { allergens: ['dairy', 'egg'] }),
];

const household: Ingredient[] = [
  ing('aluminum-foil', 'Aluminum foil', 'household', 'each', [0, 0, 0, 0, 0], 3650, true, ['aluminum foil', 'aluminium foil', 'foil', 'tin foil', 'heavy duty foil']),
  ing('parchment-paper', 'Parchment paper', 'household', 'each', [0, 0, 0, 0, 0], 3650, true, ['parchment paper', 'baking parchment', 'parchment']),
  ing('freezer-bags', 'Freezer bags', 'household', 'each', [0, 0, 0, 0, 0], 3650, true, ['freezer bags', 'ziploc freezer bags', 'zip top freezer bags', 'freezer bag']),
  ing('dish-soap', 'Dish soap', 'household', 'each', [0, 0, 0, 0, 0], 3650, true, ['dish soap', 'dishwashing liquid', 'dish detergent']),
];

const pantry: Ingredient[] = [
  ing('basmati-rice', 'Basmati rice', 'pantry', 'kg', [350, 7.1, 78.2, 0.7, 1.3], 730, true, ['basmati rice', 'basmati', 'basmati long grain rice']),
  ing('jasmine-rice', 'Jasmine rice', 'pantry', 'kg', [365, 6.5, 80.0, 0.6, 1.3], 730, true, ['jasmine rice', 'jasmine', 'fragrant jasmine rice']),
  ing('brown-rice', 'Brown rice', 'pantry', 'kg', [370, 7.9, 77.2, 2.9, 3.5], 365, true, ['brown rice', 'long grain brown rice', 'brown basmati rice']),
  ing('spaghetti', 'Spaghetti', 'pantry', 'kg', [371, 13.0, 74.7, 1.5, 3.2], 730, true, ['spaghetti', 'spaghetti pasta', 'dried spaghetti'], { allergens: ['gluten'] }),
  ing('penne', 'Penne pasta', 'pantry', 'kg', [371, 13.0, 74.7, 1.5, 3.2], 730, true, ['penne', 'penne pasta', 'rigatoni', 'fusilli'], { allergens: ['gluten'] }),
  ing('rice-noodles', 'Rice noodles', 'pantry', 'kg', [364, 5.9, 83.0, 0.6, 1.0], 730, true, ['rice noodles', 'rice vermicelli', 'pad thai noodles', 'rice stick noodles']),
  ing('egg-noodles', 'Egg noodles', 'pantry', 'kg', [384, 14.2, 71.0, 4.4, 3.0], 730, true, ['egg noodles', 'wide egg noodles', 'noodles egg'], { allergens: ['gluten', 'egg'] }),
  ing('rolled-oats', 'Rolled oats', 'pantry', 'kg', [379, 13.2, 67.7, 6.5, 10.1], 730, true, ['oats', 'rolled oats', 'large flake oats', 'quick oats', 'old fashioned oats']),
  ing('quinoa', 'Quinoa', 'pantry', 'kg', [368, 14.1, 64.2, 6.1, 7.0], 730, true, ['quinoa', 'white quinoa', 'tri-color quinoa']),
  ing('all-purpose-flour', 'All-purpose flour', 'pantry', 'kg', [364, 10.3, 76.3, 1.0, 2.7], 365, true, ['flour', 'all purpose flour', 'all-purpose flour', 'unbleached flour'], { allergens: ['gluten'] }),
  ing('canned-diced-tomatoes', 'Canned diced tomatoes', 'pantry', 'each', [24, 1.2, 4.7, 0.2, 1.2], 730, true, ['diced tomatoes', 'canned diced tomatoes', 'diced tomatoes 796 ml', 'stewed tomatoes', 'canned tomatoes'], { eachWeightKg: 0.796, eachLabel: 'one can', form: 'canned', formGroup: 'tomatoes' }),
  ing('tomato-paste', 'Tomato paste', 'pantry', 'each', [82, 4.3, 18.9, 0.5, 4.1], 730, true, ['tomato paste', 'tomato paste can', 'tomato paste 156 ml'], { eachWeightKg: 0.156, form: 'canned', formGroup: 'tomatoes' }),
  ing('coconut-milk', 'Canned coconut milk', 'pantry', 'each', [197, 2.3, 2.8, 21.3, 0], 730, true, ['coconut milk', 'canned coconut milk', 'coconut milk 400 ml', 'coconut milk can'], { eachWeightKg: 0.4 }),
  ing('soy-sauce', 'Soy sauce', 'pantry', 'l', [53, 8.1, 4.9, 0.6, 0.8], 730, true, ['soy sauce', 'soya sauce', 'light soy sauce', 'soy'], { allergens: ['soy', 'gluten'] }),
  ing('peanut-butter', 'Peanut butter', 'pantry', 'kg', [588, 25.1, 20.0, 50.4, 6.0], 365, true, ['peanut butter', 'creamy peanut butter', 'smooth peanut butter', 'crunchy peanut butter'], { allergens: ['peanut'] }),
  ing('honey', 'Honey', 'pantry', 'kg', [304, 0.3, 82.4, 0, 0.2], 3650, true, ['honey', 'liquid honey', 'pure honey']),
  ing('chicken-stock', 'Chicken stock', 'pantry', 'l', [7, 0.9, 0.3, 0.3, 0], 730, false, ['chicken stock', 'chicken broth', 'chicken stock 900 ml', 'low sodium chicken broth', 'chicken bouillon']),
  ing('vegetable-stock', 'Vegetable stock', 'pantry', 'l', [5, 0.2, 0.9, 0.2, 0.2], 730, true, ['vegetable stock', 'vegetable broth', 'veggie broth', 'veg stock']),
  ing('olive-oil', 'Olive oil', 'pantry', 'l', [884, 0, 0, 100, 0], 730, true, ['olive oil', 'extra virgin olive oil', 'evoo', 'light olive oil']),
  ing('vegetable-oil', 'Vegetable oil', 'pantry', 'l', [884, 0, 0, 100, 0], 730, true, ['vegetable oil', 'canola oil', 'cooking oil', 'sunflower oil']),
  ing('sugar', 'White sugar', 'pantry', 'kg', [387, 0, 100, 0, 0], 1825, true, ['sugar', 'white sugar', 'granulated sugar', 'brown sugar']),
  ing('garlic-powder', 'Garlic powder', 'pantry', 'kg', [331, 16.6, 72.7, 0.7, 9.0], 1095, true, ['garlic powder', 'ground garlic', 'garlic granules']),
  ing('ground-cumin', 'Ground cumin', 'pantry', 'kg', [375, 17.8, 44.2, 22.3, 10.5], 1095, true, ['cumin', 'ground cumin', 'cumin powder']),
  ing('smoked-paprika', 'Smoked paprika', 'pantry', 'kg', [282, 14.1, 53.9, 12.9, 34.9], 1095, true, ['paprika', 'smoked paprika', 'sweet paprika']),
  ing('cinnamon', 'Ground cinnamon', 'pantry', 'kg', [247, 4.0, 80.6, 1.2, 53.1], 1095, true, ['cinnamon', 'ground cinnamon', 'cinnamon powder']),
  ing('curry-powder', 'Curry powder', 'pantry', 'kg', [325, 14.3, 58.2, 14.0, 33.2], 1095, true, ['curry powder', 'madras curry powder', 'mild curry powder']),
  ing('salsa', 'Salsa', 'pantry', 'kg', [36, 1.5, 7.0, 0.2, 1.8], 180, true, ['salsa', 'medium salsa', 'mild salsa', 'chunky salsa']),
  ing('pesto', 'Basil pesto', 'pantry', 'kg', [424, 6.5, 6.0, 42.0, 2.0], 180, true, ['pesto', 'basil pesto', 'pesto sauce', 'green pesto'], { allergens: ['tree nut', 'dairy'] }),
  ing('tahini', 'Tahini', 'pantry', 'kg', [595, 17.0, 21.2, 53.8, 9.3], 365, true, ['tahini', 'sesame paste', 'tahini paste'], { allergens: ['sesame'] }),
  ing('ketchup', 'Ketchup', 'pantry', 'kg', [112, 1.2, 26.0, 0.1, 0.3], 365, true, ['ketchup', 'tomato ketchup', 'heinz ketchup']),
  ing('mayonnaise', 'Mayonnaise', 'pantry', 'kg', [680, 1.0, 0.6, 75.0, 0], 90, true, ['mayonnaise', 'mayo', 'light mayo'], { allergens: ['egg'] }),
  ing('dijon-mustard', 'Dijon mustard', 'pantry', 'kg', [66, 4.4, 5.8, 3.3, 3.3], 365, true, ['dijon mustard', 'dijon', 'yellow mustard', 'mustard']),
  ing('balsamic-vinegar', 'Balsamic vinegar', 'pantry', 'l', [88, 0.5, 17.0, 0, 0], 3650, true, ['balsamic vinegar', 'balsamic', 'balsamic glaze']),
  ing('pasta-sauce', 'Pasta sauce', 'pantry', 'l', [60, 1.7, 9.0, 2.0, 1.5], 365, true, ['pasta sauce', 'spaghetti sauce', 'marinara sauce', 'tomato pasta sauce']),
  ing('maple-syrup', 'Maple syrup', 'pantry', 'l', [260, 0, 67.0, 0.1, 0], 3650, true, ['maple syrup', 'pure maple syrup', 'maple']),
  ing('chocolate-chips', 'Chocolate chips', 'pantry', 'kg', [479, 4.2, 63.0, 25.0, 6.0], 365, true, ['chocolate chips', 'semi-sweet chocolate chips', 'dark chocolate chips', 'chocolate chip'], { allergens: ['dairy', 'soy'] }),
  ing('tortilla-chips', 'Tortilla chips', 'pantry', 'kg', [489, 7.0, 63.0, 23.0, 5.0], 180, true, ['tortilla chips', 'corn chips', 'nacho chips']),
  ing('canned-corn', 'Canned corn', 'pantry', 'each', [86, 3.2, 19.0, 1.2, 2.7], 730, true, ['canned corn', 'whole kernel corn', 'corn can', 'kernel corn'], { eachWeightKg: 0.341, form: 'canned', formGroup: 'vegetables' }),
  ing('hot-sauce', 'Hot sauce', 'pantry', 'l', [11, 0.5, 1.9, 0.4, 0.5], 1095, true, ['hot sauce', 'sriracha', 'franks hot sauce', 'chili sauce']),
];

/**
 * Typical cooking amounts, by ingredient id. Approximate: a medium onion, a large egg, a cup of dry rice as scooped.
 * Dry grains and pasta are per cup, fresh produce per piece (or head, bunch and cup), liquids per cup or tablespoon,
 * canned goods per can. Spices and garlic powder per teaspoon, fresh garlic per clove.
 */
export const COOK_AMOUNTS: Record<string, CookAmount> = {
  // Dry grains, pulses and flours: grams in a cup, as scooped.
  'jasmine-rice': { unit: 'cup', gramsPer: 185 },
  'basmati-rice': { unit: 'cup', gramsPer: 185 },
  'brown-rice': { unit: 'cup', gramsPer: 185 },
  quinoa: { unit: 'cup', gramsPer: 170 },
  'rolled-oats': { unit: 'cup', gramsPer: 90 },
  'lentils-red-dry': { unit: 'cup', gramsPer: 190 },
  'chickpeas-dry': { unit: 'cup', gramsPer: 200 },
  'black-beans-dry': { unit: 'cup', gramsPer: 175 },
  penne: { unit: 'cup', gramsPer: 100 },
  'egg-noodles': { unit: 'cup', gramsPer: 60 },
  'rice-noodles': { unit: 'cup', gramsPer: 50 },
  'all-purpose-flour': { unit: 'cup', gramsPer: 125 },
  sugar: { unit: 'cup', gramsPer: 200 },
  'chocolate-chips': { unit: 'cup', gramsPer: 170 },
  'peanut-butter': { unit: 'tbsp', gramsPer: 16 },
  honey: { unit: 'tbsp', gramsPer: 21 },
  // Spices and garlic powder: teaspoons.
  'garlic-powder': { unit: 'tsp', gramsPer: 3 },
  'ground-cumin': { unit: 'tsp', gramsPer: 2 },
  'smoked-paprika': { unit: 'tsp', gramsPer: 2.3 },
  cinnamon: { unit: 'tsp', gramsPer: 2.6 },
  'curry-powder': { unit: 'tsp', gramsPer: 2.2 },
  'dijon-mustard': { unit: 'tsp', gramsPer: 5 },
  'hot-sauce': { unit: 'tsp', gramsPer: 5 },
  // Garlic, onions and other vegetables: pieces, heads, bunches and cups.
  garlic: { unit: 'clove', gramsPer: 5, singular: 'clove', plural: 'cloves' },
  'yellow-onion': { unit: 'piece', gramsPer: 150, singular: 'onion', plural: 'onions' },
  'red-onion': { unit: 'piece', gramsPer: 170, singular: 'onion', plural: 'onions' },
  'green-onions': { unit: 'piece', gramsPer: 15, singular: 'green onion', plural: 'green onions' },
  'green-cabbage': { unit: 'head', gramsPer: 900, singular: 'head', plural: 'heads' },
  cauliflower: { unit: 'head', gramsPer: 600, singular: 'head', plural: 'heads' },
  'romaine-lettuce': { unit: 'head', gramsPer: 450, singular: 'head', plural: 'heads' },
  carrots: { unit: 'piece', gramsPer: 70, singular: 'carrot', plural: 'carrots' },
  potatoes: { unit: 'piece', gramsPer: 170, singular: 'potato', plural: 'potatoes' },
  'sweet-potatoes': { unit: 'piece', gramsPer: 250, singular: 'sweet potato', plural: 'sweet potatoes' },
  'roma-tomatoes': { unit: 'piece', gramsPer: 75, singular: 'tomato', plural: 'tomatoes' },
  'cherry-tomatoes': { unit: 'cup', gramsPer: 150 },
  'red-bell-pepper': { unit: 'piece', gramsPer: 160, singular: 'red pepper', plural: 'red peppers' },
  'green-bell-pepper': { unit: 'piece', gramsPer: 160, singular: 'bell pepper', plural: 'bell peppers' },
  'english-cucumber': { unit: 'piece', gramsPer: 350, singular: 'cucumber', plural: 'cucumbers' },
  'mini-cucumbers': { unit: 'piece', gramsPer: 60, singular: 'mini cucumber', plural: 'mini cucumbers' },
  eggplant: { unit: 'piece', gramsPer: 300, singular: 'eggplant', plural: 'eggplants' },
  zucchini: { unit: 'piece', gramsPer: 200, singular: 'zucchini', plural: 'zucchini' },
  'corn-cobs': { unit: 'piece', gramsPer: 200, singular: 'cob', plural: 'cobs' },
  jalapenos: { unit: 'piece', gramsPer: 15, singular: 'jalapeño', plural: 'jalapeños' },
  ginger: { unit: 'tbsp', gramsPer: 6 },
  cilantro: { unit: 'bunch', gramsPer: 50 },
  parsley: { unit: 'bunch', gramsPer: 50 },
  celery: { unit: 'bunch', gramsPer: 500 },
  spinach: { unit: 'cup', gramsPer: 30 },
  kale: { unit: 'cup', gramsPer: 60 },
  broccoli: { unit: 'cup', gramsPer: 90 },
  'white-mushrooms': { unit: 'cup', gramsPer: 70 },
  'green-beans': { unit: 'cup', gramsPer: 100 },
  'butternut-squash': { unit: 'cup', gramsPer: 205 },
  // Fruit.
  bananas: { unit: 'piece', gramsPer: 120, singular: 'banana', plural: 'bananas' },
  'gala-apples': { unit: 'piece', gramsPer: 180, singular: 'apple', plural: 'apples' },
  'navel-oranges': { unit: 'piece', gramsPer: 150, singular: 'orange', plural: 'oranges' },
  lemons: { unit: 'piece', gramsPer: 100, singular: 'lemon', plural: 'lemons' },
  limes: { unit: 'piece', gramsPer: 70, singular: 'lime', plural: 'limes' },
  avocado: { unit: 'piece', gramsPer: 200, singular: 'avocado', plural: 'avocados' },
  pears: { unit: 'piece', gramsPer: 170, singular: 'pear', plural: 'pears' },
  mangoes: { unit: 'piece', gramsPer: 300, singular: 'mango', plural: 'mangoes' },
  pineapple: { unit: 'piece', gramsPer: 1200, singular: 'pineapple', plural: 'pineapples' },
  'grapes-red': { unit: 'cup', gramsPer: 150 },
  'grapes-green': { unit: 'cup', gramsPer: 150 },
  strawberries: { unit: 'cup', gramsPer: 150 },
  blueberries: { unit: 'cup', gramsPer: 150 },
  raspberries: { unit: 'cup', gramsPer: 125 },
  // Frozen vegetables and fruit: cups.
  'frozen-peas': { unit: 'cup', gramsPer: 135 },
  'frozen-mixed-veg': { unit: 'cup', gramsPer: 140 },
  'frozen-broccoli': { unit: 'cup', gramsPer: 90 },
  'frozen-corn': { unit: 'cup', gramsPer: 165 },
  'frozen-berries': { unit: 'cup', gramsPer: 140 },
  'edamame-frozen': { unit: 'cup', gramsPer: 155 },
  // Eggs, bread and bakery: pieces and slices.
  'eggs-large': { unit: 'piece', gramsPer: 58, singular: 'egg', plural: 'eggs' },
  'white-bread': { unit: 'slice', gramsPer: 30, singular: 'slice', plural: 'slices' },
  'whole-wheat-bread': { unit: 'slice', gramsPer: 30, singular: 'slice', plural: 'slices' },
  'flour-tortillas': { unit: 'piece', gramsPer: 45, singular: 'tortilla', plural: 'tortillas' },
  'corn-tortillas': { unit: 'piece', gramsPer: 25, singular: 'tortilla', plural: 'tortillas' },
  naan: { unit: 'piece', gramsPer: 100, singular: 'naan', plural: 'naan' },
  pita: { unit: 'piece', gramsPer: 60, singular: 'pita', plural: 'pitas' },
  bagels: { unit: 'piece', gramsPer: 100, singular: 'bagel', plural: 'bagels' },
  // Dairy: cups for milk and cheese, tablespoons for butter and cream cheese.
  'milk-2-percent': { unit: 'cup', gramsPer: 240 },
  'whipping-cream': { unit: 'cup', gramsPer: 240 },
  'greek-yogurt': { unit: 'cup', gramsPer: 245 },
  'yogurt-plain': { unit: 'cup', gramsPer: 245 },
  'sour-cream': { unit: 'cup', gramsPer: 230 },
  cheddar: { unit: 'cup', gramsPer: 113 },
  mozzarella: { unit: 'cup', gramsPer: 113 },
  paneer: { unit: 'cup', gramsPer: 150 },
  butter: { unit: 'tbsp', gramsPer: 14 },
  'cream-cheese': { unit: 'tbsp', gramsPer: 15 },
  // Stock, oil, sauces and condiments.
  'chicken-stock': { unit: 'cup', gramsPer: 240 },
  'vegetable-stock': { unit: 'cup', gramsPer: 240 },
  'pasta-sauce': { unit: 'cup', gramsPer: 250 },
  'olive-oil': { unit: 'tbsp', gramsPer: 15 },
  'vegetable-oil': { unit: 'tbsp', gramsPer: 15 },
  'soy-sauce': { unit: 'tbsp', gramsPer: 16 },
  'balsamic-vinegar': { unit: 'tbsp', gramsPer: 15 },
  'maple-syrup': { unit: 'tbsp', gramsPer: 20 },
  tahini: { unit: 'tbsp', gramsPer: 15 },
  pesto: { unit: 'tbsp', gramsPer: 15 },
  hummus: { unit: 'tbsp', gramsPer: 15 },
  salsa: { unit: 'tbsp', gramsPer: 16 },
  ketchup: { unit: 'tbsp', gramsPer: 17 },
  mayonnaise: { unit: 'tbsp', gramsPer: 14 },
  // Canned goods: one can each, at the can's typical size.
  'canned-tuna': { unit: 'can', gramsPer: 142, singular: 'can', plural: 'cans' },
  'canned-salmon': { unit: 'can', gramsPer: 213, singular: 'can', plural: 'cans' },
  'chickpeas-canned': { unit: 'can', gramsPer: 425, singular: 'can', plural: 'cans' },
  'black-beans-canned': { unit: 'can', gramsPer: 398, singular: 'can', plural: 'cans' },
  'lentils-canned': { unit: 'can', gramsPer: 398, singular: 'can', plural: 'cans' },
  'kidney-beans-canned': { unit: 'can', gramsPer: 398, singular: 'can', plural: 'cans' },
  'pinto-beans-canned': { unit: 'can', gramsPer: 398, singular: 'can', plural: 'cans' },
  'canned-diced-tomatoes': { unit: 'can', gramsPer: 796, singular: 'can', plural: 'cans' },
  'tomato-paste': { unit: 'can', gramsPer: 156, singular: 'can', plural: 'cans' },
  'canned-corn': { unit: 'can', gramsPer: 341, singular: 'can', plural: 'cans' },
  'coconut-milk': { unit: 'can', gramsPer: 400, singular: 'can', plural: 'cans' },
  // Fish and meat: fillets and pieces.
  'salmon-fillet': { unit: 'fillet', gramsPer: 150, singular: 'fillet', plural: 'fillets' },
  'tilapia-fillet': { unit: 'fillet', gramsPer: 130, singular: 'fillet', plural: 'fillets' },
  'cod-fillet': { unit: 'fillet', gramsPer: 150, singular: 'fillet', plural: 'fillets' },
  'chicken-breast-boneless': { unit: 'piece', gramsPer: 170, singular: 'breast', plural: 'breasts' },
  'chicken-thigh-boneless': { unit: 'piece', gramsPer: 110, singular: 'thigh', plural: 'thighs' },
  'chicken-thigh-bone-in': { unit: 'piece', gramsPer: 120, singular: 'thigh', plural: 'thighs' },
  'chicken-drumsticks': { unit: 'piece', gramsPer: 110, singular: 'drumstick', plural: 'drumsticks' },
  'pork-chops': { unit: 'piece', gramsPer: 130, singular: 'chop', plural: 'chops' },
  'italian-sausage': { unit: 'piece', gramsPer: 140, singular: 'sausage', plural: 'sausages' },
};

const withCookAmounts = (list: Ingredient[]): Ingredient[] =>
  list.map((i) => (COOK_AMOUNTS[i.id] ? { ...i, cook: COOK_AMOUNTS[i.id] } : i));

export const INGREDIENTS: Ingredient[] = withCookAmounts([
  ...meat,
  ...seafood,
  ...proteinsOther,
  ...produce,
  ...dairy,
  ...bakery,
  ...deli,
  ...frozen,
  ...pantry,
  ...household,
]);

export const INGREDIENT_BY_ID: Record<string, Ingredient> = Object.fromEntries(
  INGREDIENTS.map((i) => [i.id, i]),
);
