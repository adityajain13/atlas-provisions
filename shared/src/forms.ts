// Food forms: which forms of a food the household keeps (fresh, frozen, canned, dry). Groups are built from the
// catalogue's `form` and `formGroup` tags, so a new tagged entry joins its group without a list to maintain here.
import { z } from 'zod';
import { INGREDIENTS, INGREDIENT_BY_ID, type FoodForm, type FormGroupKey } from './catalog';

// The order the form chips show: canned is always last. Each group shows the forms it has, in this order.
export const FOOD_FORMS = ['fresh', 'frozen', 'dry', 'canned'] as const satisfies readonly FoodForm[];
export const FoodFormSchema = z.enum(FOOD_FORMS);

export const FORM_LABEL: Record<FoodForm, string> = {
  fresh: 'Fresh',
  frozen: 'Frozen',
  canned: 'Canned',
  dry: 'Dry',
};

export const FORM_GROUP_LABEL: Record<FormGroupKey, string> = {
  fish: 'Fish & seafood',
  beans: 'Beans & lentils',
  vegetables: 'Vegetables',
  tomatoes: 'Tomatoes',
  fruit: 'Fruit',
};

export const FORM_GROUP_KEYS = ['fish', 'beans', 'vegetables', 'tomatoes', 'fruit'] as const satisfies readonly FormGroupKey[];

export interface FormGroup {
  key: FormGroupKey;
  label: string;
  forms: FoodForm[]; // the forms this group has catalogue entries for, in FOOD_FORMS order
  members: Record<FoodForm, string[]>; // catalogue ids in each form
}

/** Every group, with the forms and catalogue ids it has. */
export const FORM_GROUPS: FormGroup[] = FORM_GROUP_KEYS.map((key) => {
  const members = Object.fromEntries(FOOD_FORMS.map((f) => [f, [] as string[]])) as Record<FoodForm, string[]>;
  for (const ing of INGREDIENTS) {
    if (ing.formGroup === key && ing.form) members[ing.form].push(ing.id);
  }
  return {
    key,
    label: FORM_GROUP_LABEL[key],
    forms: FOOD_FORMS.filter((f) => members[f].length > 0),
    members,
  };
});

/** The household's form choices: group key to the forms it keeps. A missing or empty group keeps every form. */
export type FormChoices = Partial<Record<string, FoodForm[]>>;

/** The forms a group keeps: the stored choice, limited to the group's own forms, or all of them when nothing is stored. */
export function allowedForms(choices: FormChoices | undefined, key: FormGroupKey): FoodForm[] {
  const group = FORM_GROUPS.find((g) => g.key === key);
  if (!group) return [];
  const stored = choices?.[key];
  if (!stored || stored.length === 0) return [...group.forms];
  return group.forms.filter((f) => stored.includes(f));
}

/** Every group's kept forms, for the planner's payload. */
export function formsAllowedFor(choices: FormChoices | undefined): Record<FormGroupKey, FoodForm[]> {
  return Object.fromEntries(FORM_GROUPS.map((g) => [g.key, allowedForms(choices, g.key)])) as Record<FormGroupKey, FoodForm[]>;
}

/** The catalogue ids whose form the household does not keep. Ingredients with no form tag are never blocked. */
export function blockedFormIds(choices: FormChoices | undefined): Set<string> {
  const blocked = new Set<string>();
  for (const group of FORM_GROUPS) {
    const kept = new Set(allowedForms(choices, group.key));
    for (const form of group.forms) {
      if (kept.has(form)) continue;
      for (const id of group.members[form]) blocked.add(id);
    }
  }
  return blocked;
}

/** The form a catalogue ingredient is sold in, when it has one. */
export function formOf(ingredientId: string): FoodForm | undefined {
  return INGREDIENT_BY_ID[ingredientId]?.form;
}

/** The group a catalogue ingredient belongs to, when it has one. */
export function formGroupOf(ingredientId: string): FormGroupKey | undefined {
  return INGREDIENT_BY_ID[ingredientId]?.formGroup;
}
