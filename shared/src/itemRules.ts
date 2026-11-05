// Item rules: which catalogue ingredients a never-buy or always-buy name stands for. Pure, so the Worker and the web
// app agree on what a rule covers.
import { INGREDIENTS } from './catalog';
import { containsSeq, matchIngredient, tokensOf } from './match';

/** Protein tags a single word can name. "Beef" covers every ingredient tagged beef, not only the ones named beef. */
const PROTEIN_TERMS: ReadonlySet<string> = new Set([
  'chicken',
  'beef',
  'pork',
  'turkey',
  'fish',
  'seafood',
  'egg',
  'tofu',
  'legume',
  'dairy',
]);

/** Each ingredient's searchable forms: its name and aliases, as folded word lists. Built once. */
const SEARCH_FORMS = INGREDIENTS.map((ing) => ({
  id: ing.id,
  protein: ing.protein,
  forms: [tokensOf(ing.name), ...ing.aliases.map(tokensOf)],
}));

/**
 * Every catalogue ingredient a never-buy name covers, in catalogue order. Three routes, unioned:
 * - a single word that is a protein tag ("beef", "eggs") covers every ingredient with that tag;
 * - a name or alias that contains the words, in order, covers the ingredient ("corn" finds corn on the cob,
 *   frozen corn, canned corn, corn tortillas and tortilla chips; "popcorn" does not match);
 * - the best match for the whole name, as matchIngredient reads it.
 */
export function expandRule(name: string): string[] {
  const term = tokensOf(name);
  if (term.length === 0) return [];
  const proteinTerm = term.length === 1 && PROTEIN_TERMS.has(term[0]!) ? term[0]! : undefined;
  const hits = new Set<string>();
  for (const entry of SEARCH_FORMS) {
    if (proteinTerm !== undefined && entry.protein === proteinTerm) hits.add(entry.id);
    if (entry.forms.some((form) => containsSeq(form, term))) hits.add(entry.id);
  }
  const best = matchIngredient(name);
  if (best) hits.add(best.ingredientId);
  return INGREDIENTS.map((ing) => ing.id).filter((id) => hits.has(id));
}

/** The ingredients a never-buy rule blocks: its expansion, less the ones the household un-ticked. */
export function blockedIds(rule: { name: string; except?: string[] }): string[] {
  const except = new Set(rule.except ?? []);
  return expandRule(rule.name).filter((id) => !except.has(id));
}

/**
 * The one ingredient an always-buy name stands for: its best match, else the first ingredient it covers.
 * Undefined when nothing in the catalogue fits, so the UI can say so.
 */
export function alwaysBuyId(name: string): string | undefined {
  return matchIngredient(name)?.ingredientId ?? expandRule(name)[0];
}

/**
 * Whether a meal name contains the word, as a whole word and plural-folded: "Beef stir-fry" has "beef",
 * "Beefy chili" does not, and "Pork chops" has "pork" and "chop" as words.
 */
export function nameHasWord(mealName: string, word: string): boolean {
  const w = tokensOf(word);
  return w.length > 0 && containsSeq(tokensOf(mealName), w);
}
