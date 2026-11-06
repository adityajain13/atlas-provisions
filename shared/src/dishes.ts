// Dishes the household does not want, matched against planned meal names.
import { containsSeq, tokensOf } from './match';

/** Shortest avoid word that also matches inside a longer word, so "pie" does not catch "pierogi". */
const COMPOUND_MIN_LETTERS = 4;

/**
 * The avoid word a meal name is, or contains, or undefined. A word matches as whole words, plural-folded: "slaw" is in
 * "Slaw bowl". A word of four letters or more also matches inside a compound: "slaw" is in "Coleslaw" and "Cabbage slaw".
 */
export function avoidedDish(mealName: string, avoid: string[] | undefined): string | undefined {
  if (!avoid || avoid.length === 0) return undefined;
  const name = tokensOf(mealName);
  const joined = name.join('');
  for (const raw of avoid) {
    const word = tokensOf(raw);
    if (word.length === 0) continue;
    if (containsSeq(name, word)) return raw.trim().toLowerCase();
    const compact = word.join('');
    if (compact.length >= COMPOUND_MIN_LETTERS && joined.includes(compact)) return raw.trim().toLowerCase();
  }
  return undefined;
}
