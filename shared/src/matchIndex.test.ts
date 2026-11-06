// matchIngredient scores only the aliases that share a word with a name, through an inverted index. This checks the
// result is the same as scoring every alias, as the original code did, over the fixture flyer and every catalog alias.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INGREDIENTS, type Category } from './catalog';
import { CATEGORY_HINTS, NON_INGREDIENT_PHRASES, containsSeq, matchIngredient, normalizeRawName, tokensOf } from './match';

/** The original brute-force matcher: every alias of every ingredient is scored. Kept here as the reference. */
const ALIASES = INGREDIENTS.map((ingredient) => ({
  ingredient,
  aliases: ingredient.aliases.map((a) => ({ tokens: tokensOf(a), length: a.length })).filter((a) => a.tokens.length > 0),
}));
const NON_INGREDIENT = NON_INGREDIENT_PHRASES.map(tokensOf);
const HINTS: Partial<Record<Category, string[][]>> = Object.fromEntries(
  (Object.entries(CATEGORY_HINTS) as [Category, string[]][]).map(([cat, hints]) => [cat, hints.map(tokensOf)]),
);

function bruteForceMatch(rawName: string): { ingredientId: string; confidence: number } | null {
  const tokens = tokensOf(normalizeRawName(rawName));
  if (tokens.length === 0) return null;
  if (NON_INGREDIENT.some((seq) => containsSeq(tokens, seq))) return null;
  const present = new Set(tokens);

  let best: { ingredientId: string; score: number; aliasLen: number; confidence: number } | null = null;
  for (const entry of ALIASES) {
    let hit: { size: number; length: number; score: number } | null = null;
    for (const alias of entry.aliases) {
      if (!alias.tokens.every((t) => present.has(t))) continue;
      const contiguous = containsSeq(tokens, alias.tokens);
      const size = alias.tokens.length;
      const score = size + (contiguous ? 0.5 : 0);
      if (!hit || score > hit.score || (score === hit.score && alias.length > hit.length)) {
        hit = { size, length: alias.length, score };
      }
    }
    if (!hit) continue;
    let confidence = hit.size >= 2 ? 0.9 : 0.7;
    if ((HINTS[entry.ingredient.category] ?? []).some((h) => containsSeq(tokens, h))) confidence += 0.05;
    confidence = Math.min(1, Math.round(confidence * 100) / 100);
    if (best === null || hit.score > best.score || (hit.score === best.score && hit.length > best.aliasLen)) {
      best = { ingredientId: entry.ingredient.id, score: hit.score, aliasLen: hit.length, confidence };
    }
  }
  if (!best || best.confidence <= 0.6) return null;
  return { ingredientId: best.ingredientId, confidence: best.confidence };
}

const fixture = JSON.parse(
  readFileSync(new URL('../../worker/fixtures/flyer-sample.json', import.meta.url), 'utf8'),
) as { rawName: string }[];
const names = [
  ...fixture.map((i) => i.rawName),
  ...INGREDIENTS.flatMap((i) => i.aliases),
  'Nestle Drumstick 4 pk',
  'Chicken thighs or pork chops',
  '',
  '2 x 355 ml',
];

describe('matchIngredient with the inverted index', () => {
  it('gives the same match as scoring every alias, for every fixture line and catalog alias', () => {
    const differences = names.filter((n) => JSON.stringify(matchIngredient(n)) !== JSON.stringify(bruteForceMatch(n)));
    expect(differences).toEqual([]);
  });

  it('keeps the fixture match rate at 95% or more', () => {
    const matched = fixture.filter((i) => matchIngredient(i.rawName) !== null).length;
    expect(matched / fixture.length).toBeGreaterThanOrEqual(0.95);
  });
});
