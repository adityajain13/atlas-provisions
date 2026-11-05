// Meal names come from the planner in whatever case it wrote them. The week headline reads as a
// sentence, so its first letter goes lowercase, except after a proper adjective such as "Italian".

const PROPER_ADJECTIVES = new Set(
  [
    'Italian', 'Thai', 'Indian', 'Greek', 'Mexican', 'Korean', 'Japanese', 'Chinese', 'Cajun', 'Moroccan',
    'French', 'Spanish', 'Vietnamese', 'Turkish', 'Lebanese', 'Caribbean', 'Jamaican',
  ].map((w) => w.toLowerCase()),
);

// Trailing notes the planner adds that do not belong in a headline: "(2 portions)", "(serves 2)",
// "(x2)", "– 2 portions", ", serves 4".
const TRAILING_NOTES: RegExp[] = [
  /\s*\([^()]*\)\s*$/,
  /\s*[–—-]\s*(?:\d+\s*(?:portions?|servings?|people|ppl)|(?:serves|makes)\s+\d+)\s*$/i,
  /[,\s]+(?:serves|makes)\s+\d+\s*$/i,
];

/** The meal name without trailing portion or serving notes. Grid cards and the detail keep the full name. */
export function stripPortionNotes(name: string): string {
  let out = name;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    for (const re of TRAILING_NOTES) out = out.replace(re, '');
  }
  const trimmed = out.trim();
  return trimmed === '' ? name : trimmed;
}

/** A meal name as it reads mid-sentence: "Sheet-pan salmon" becomes "sheet-pan salmon". */
export function headlineName(full: string): string {
  const name = stripPortionNotes(full);
  const word = /^[A-Za-z]+/.exec(name)?.[0] ?? '';
  if (PROPER_ADJECTIVES.has(word.toLowerCase())) return name;
  // Only a capital followed by a lowercase letter: "BBQ ribs" and "A" stay as written.
  if (!/^[A-Z][a-z]/.test(name)) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}
