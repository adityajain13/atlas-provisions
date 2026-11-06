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

/**
 * Processed foods named after a base food: cornstarch and polenta come from corn, masa harina from corn too, and
 * flours from grain. A word rule for the base ("corn", "wheat") does not reach them; a rule that names one does.
 */
const DERIVED_WORDS = ['starch', 'flour', 'meal', 'masa', 'polenta', 'grits', 'syrup'] as const;

/** Each ingredient's searchable forms: its name and aliases, as folded word lists. Built once. */
const SEARCH_FORMS = INGREDIENTS.map((ing) => ({
  id: ing.id,
  protein: ing.protein,
  derived: DERIVED_WORDS.some((w) => `${ing.id} ${tokensOf(ing.name).join(' ')}`.includes(w)),
  forms: [tokensOf(ing.name), ...ing.aliases.map(tokensOf)],
}));

/** Whether the rule's own words name a derived food, such as "cornstarch", "masa" or "syrup". */
function namesDerived(term: string[]): boolean {
  return term.some((t) => DERIVED_WORDS.some((w) => t.includes(w)));
}

/**
 * Every catalogue ingredient a never-buy name covers, in catalogue order. Three routes, unioned:
 * - a single word that is a protein tag ("beef", "eggs") covers every ingredient with that tag;
 * - a name or alias that contains the words, in order, covers the ingredient ("corn" finds corn on the cob,
 *   frozen corn, canned corn, corn tortillas and tortilla chips; "popcorn" does not match);
 * - the best match for the whole name, as matchIngredient reads it.
 * Word matches leave out processed foods derived from the word (cornstarch, polenta, masa harina for "corn"),
 * unless the name itself names one or matches an ingredient's name or alias exactly ("tortillas" still covers
 * flour tortillas, whose alias is exactly "tortillas").
 */
export function expandRule(name: string): string[] {
  const term = tokensOf(name);
  if (term.length === 0) return [];
  const proteinTerm = term.length === 1 && PROTEIN_TERMS.has(term[0]!) ? term[0]! : undefined;
  const termText = term.join(' ');
  const named = namesDerived(term);
  const hits = new Set<string>();
  for (const entry of SEARCH_FORMS) {
    if (proteinTerm !== undefined && entry.protein === proteinTerm) hits.add(entry.id);
    if (!entry.forms.some((form) => containsSeq(form, term))) continue;
    const exact = entry.forms.some((form) => form.join(' ') === termText);
    if (!entry.derived || named || exact) hits.add(entry.id);
  }
  const best = matchIngredient(name);
  if (best) {
    const entry = SEARCH_FORMS.find((e) => e.id === best.ingredientId);
    if (!entry?.derived || named || entry.forms.some((form) => form.join(' ') === termText)) hits.add(best.ingredientId);
  }
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
