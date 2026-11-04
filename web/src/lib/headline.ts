// Meal names come from the planner in whatever case it wrote them. The week headline reads as a
// sentence, so its first letter goes lowercase, except after a proper adjective such as "Italian".

const PROPER_ADJECTIVES = new Set(
  [
    'Italian', 'Thai', 'Indian', 'Greek', 'Mexican', 'Korean', 'Japanese', 'Chinese', 'Cajun', 'Moroccan',
    'French', 'Spanish', 'Vietnamese', 'Turkish', 'Lebanese', 'Caribbean', 'Jamaican',
  ].map((w) => w.toLowerCase()),
);

/** A meal name as it reads mid-sentence: "Sheet-pan salmon" becomes "sheet-pan salmon". */
export function headlineName(name: string): string {
  const word = /^[A-Za-z]+/.exec(name)?.[0] ?? '';
  if (PROPER_ADJECTIVES.has(word.toLowerCase())) return name;
  // Only a capital followed by a lowercase letter: "BBQ ribs" and "A" stay as written.
  if (!/^[A-Z][a-z]/.test(name)) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}
