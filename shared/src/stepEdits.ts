// Cooking steps as the household changed them. An ingredient it skipped is struck through in the step that names it;
// one it replaced shows the original struck and the replacement in its place. A step that only ever names a skipped
// ingredient, with nothing left to do, is marked skipped as a whole. Pure, so the web app and the tests share it.

export interface StepEdit {
  name: string; // the catalogue name, e.g. "Mangoes"
  aliases?: string[]; // the catalogue aliases, lowercase, e.g. "mango"
  kind: 'skipped' | 'replaced';
  replacement?: string; // for replaced: what the household used instead, as typed
}

export type StepSegmentKind = 'plain' | 'skipped' | 'replacedFrom' | 'replacedTo';

export interface StepSegment {
  text: string;
  kind: StepSegmentKind;
}

export interface AnnotatedStep {
  segments: StepSegment[];
  wholeStepSkipped: boolean;
}

/** Words that do no work on their own: a step made only of these and skipped ingredients has nothing left to do. */
export const STEP_FILLER_WORDS: ReadonlySet<string> = new Set([
  'serve', 'with', 'sliced', 'diced', 'chopped', 'add', 'top', 'garnish', 'the', 'a', 'and', 'some', 'fresh', 'on', 'side', 'of', 'in', 'to',
]);

const LETTERS = '\\p{L}\\p{N}';

/**
 * Singular and plural spellings of one word: mango and mangoes, tomato and tomatoes, berry and berries, chili and
 * chilies. Only whole words are matched, so the forms never reach inside another word.
 */
export function wordForms(word: string): string[] {
  const w = word.toLowerCase();
  const out = new Set<string>([w]);
  if (w.length < 3) return [...out];
  if (w.endsWith('ies')) out.add(`${w.slice(0, -3)}y`);
  if (w.endsWith('oes')) out.add(w.slice(0, -2));
  if (w.endsWith('es')) out.add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) out.add(w.slice(0, -1));
  if (w.endsWith('y') && !/[aeiou]y$/.test(w)) out.add(`${w.slice(0, -1)}ies`);
  out.add(`${w}s`);
  out.add(`${w}es`);
  return [...out];
}

/** Every spelling of a phrase: its last word takes the singular and plural forms. */
function phraseForms(phrase: string): string[] {
  const words = phrase.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const last = words[words.length - 1]!;
  const head = words.slice(0, -1).join(' ');
  return [...new Set(wordForms(last).map((f) => (head ? `${head} ${f}` : f)))];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A pattern matching any of the phrases as whole words, spaces matching any run of spaces. */
function patternFor(phrases: string[]): RegExp | null {
  const alts = [...new Set(phrases)]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.split(/\s+/).map(escapeRe).join('\\s+'));
  if (alts.length === 0) return null;
  return new RegExp(`(?<![${LETTERS}])(?:${alts.join('|')})(?![${LETTERS}])`, 'giu');
}

interface Hit {
  start: number;
  end: number;
  edit: StepEdit;
  text: string;
}

/**
 * The phrases one edit answers to: its name and aliases in every spelling. The head noun of a multi-word name
 * ("onions" in "Green onions") is matched only when no other ingredient of the meal uses that word.
 */
function editPatterns(edit: StepEdit, mealNames: string[]): RegExp | null {
  const phrases = [edit.name, ...(edit.aliases ?? [])].flatMap(phraseForms);
  const words = edit.name.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const head = words[words.length - 1]!;
    const shared = mealNames.some((other) => other.toLowerCase() !== edit.name.toLowerCase() && wordsOf(other).some((w) => wordForms(head).includes(w)));
    if (!shared) phrases.push(...wordForms(head));
  }
  return patternFor(phrases);
}

const wordsOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Every match of the edits in one step, longest first where they overlap, with no overlaps kept. */
function hitsIn(text: string, edits: StepEdit[], mealNames: string[]): Hit[] {
  const found: Hit[] = [];
  for (const edit of edits) {
    const re = editPatterns(edit, mealNames);
    if (!re) continue;
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      found.push({ start: m.index, end: m.index + m[0].length, edit, text: m[0] });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Hit[] = [];
  let last = 0;
  for (const h of found) {
    if (h.start < last) continue;
    kept.push(h);
    last = h.end;
  }
  return kept;
}

/**
 * Each step as segments, in order, with the edits marked: a skipped ingredient is one `skipped` segment; a replaced one
 * is `replacedFrom` (the original) and `replacedTo` (the replacement, with a leading space). `mealNames` are the meal's
 * ingredient names, so a shared head noun ("onions") is not claimed for one of them.
 */
export function annotateSteps(steps: string[], edits: StepEdit[], mealNames: string[] = []): AnnotatedStep[] {
  const names = [...mealNames, ...edits.map((e) => e.name)];
  return steps.map((text) => {
    const hits = hitsIn(text, edits, names);
    const segments: StepSegment[] = [];
    let cursor = 0;
    for (const h of hits) {
      if (h.start > cursor) segments.push({ text: text.slice(cursor, h.start), kind: 'plain' });
      if (h.edit.kind === 'skipped') {
        segments.push({ text: h.text, kind: 'skipped' });
      } else {
        segments.push({ text: h.text, kind: 'replacedFrom' });
        const to = h.edit.replacement?.trim();
        if (to) segments.push({ text: ` ${to}`, kind: 'replacedTo' });
      }
      cursor = h.end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), kind: 'plain' });
    return { segments, wholeStepSkipped: isWholeStepSkipped(text, hits) };
  });
}

/** A step that names a skipped ingredient and nothing else that needs doing. A replaced ingredient is still work. */
function isWholeStepSkipped(text: string, hits: Hit[]): boolean {
  const skipped = hits.filter((h) => h.edit.kind === 'skipped');
  if (skipped.length === 0 || skipped.length !== hits.length) return false;
  let rest = '';
  let cursor = 0;
  for (const h of skipped) {
    rest += `${text.slice(cursor, h.start)} `;
    cursor = h.end;
  }
  rest += text.slice(cursor);
  return wordsOf(rest).every((w) => STEP_FILLER_WORDS.has(w));
}
