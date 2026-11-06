import { describe, expect, it } from 'vitest';
import { annotateSteps, wordForms, type StepEdit } from './stepEdits';

const mango: StepEdit = { name: 'Mangoes', aliases: ['mango', 'mangoes', 'mangos'], kind: 'skipped' };
const eggs: StepEdit = { name: 'Eggs', aliases: ['egg', 'large eggs'], kind: 'replaced', replacement: 'tofu' };

describe('annotateSteps: skipped ingredients', () => {
  it('marks a step that only serves a skipped ingredient as a whole skipped step', () => {
    const [step] = annotateSteps(['Serve with sliced mango.'], [mango]);
    expect(step!.wholeStepSkipped).toBe(true);
    expect(step!.segments).toEqual([
      { text: 'Serve with sliced ', kind: 'plain' },
      { text: 'mango', kind: 'skipped' },
      { text: '.', kind: 'plain' },
    ]);
  });

  it('strikes only the skipped word when the step still has work to do', () => {
    const [step] = annotateSteps(['Serve with mango and fresh lime.'], [mango]);
    expect(step!.wholeStepSkipped).toBe(false);
    expect(step!.segments.filter((s) => s.kind === 'skipped').map((s) => s.text)).toEqual(['mango']);
  });

  it('matches plural and singular forms, case-insensitively, as whole words only', () => {
    const steps = annotateSteps(['Add 2 Mango to the bowl.', 'Top with mangosteen.'], [mango]);
    expect(steps[0]!.segments.some((s) => s.kind === 'skipped' && s.text === 'Mango')).toBe(true);
    expect(steps[1]!.segments.every((s) => s.kind === 'plain')).toBe(true);
  });

  it('strikes every mention in one step', () => {
    const [step] = annotateSteps(['Fold the mango through, then top with more mango.'], [mango]);
    expect(step!.segments.filter((s) => s.kind === 'skipped')).toHaveLength(2);
  });

  it('leaves steps alone when nothing was changed', () => {
    const [step] = annotateSteps(['Serve with sliced mango.'], []);
    expect(step).toEqual({ segments: [{ text: 'Serve with sliced mango.', kind: 'plain' }], wholeStepSkipped: false });
  });
});

describe('annotateSteps: replaced ingredients', () => {
  it('shows the original struck and the replacement after it', () => {
    const [step] = annotateSteps(['Scramble in the eggs, add rice and soy sauce'], [eggs]);
    expect(step!.wholeStepSkipped).toBe(false);
    expect(step!.segments).toEqual([
      { text: 'Scramble in the ', kind: 'plain' },
      { text: 'eggs', kind: 'replacedFrom' },
      { text: ' tofu', kind: 'replacedTo' },
      { text: ', add rice and soy sauce', kind: 'plain' },
    ]);
  });

  it('never marks a replaced step as skipped, even when it names nothing else', () => {
    const [step] = annotateSteps(['Serve with sliced eggs.'], [eggs]);
    expect(step!.wholeStepSkipped).toBe(false);
  });

  it('shows only the original struck when no replacement was typed', () => {
    const [step] = annotateSteps(['Crack the eggs.'], [{ ...eggs, replacement: '' }]);
    expect(step!.segments.map((s) => s.kind)).toEqual(['plain', 'replacedFrom', 'plain']);
  });

  it('mixes skipped and replaced ingredients in one step', () => {
    const edits: StepEdit[] = [mango, { name: 'Lime', aliases: ['limes', 'lime'], kind: 'replaced', replacement: 'lemon' }];
    const [step] = annotateSteps(['Toss the mango with lime juice.'], edits);
    expect(step!.segments.map((s) => s.kind)).toEqual(['plain', 'skipped', 'plain', 'replacedFrom', 'replacedTo', 'plain']);
  });
});

describe('annotateSteps: shared head nouns', () => {
  const greenOnions: StepEdit = { name: 'Green onions', aliases: ['scallions'], kind: 'skipped' };

  it('matches the head noun of a multi-word name when no other ingredient uses it', () => {
    const [step] = annotateSteps(['Top with onions.'], [greenOnions], ['Green onions']);
    expect(step!.segments.some((s) => s.kind === 'skipped' && s.text === 'onions')).toBe(true);
  });

  it('leaves the head noun alone when another ingredient of the meal is onions', () => {
    const [step] = annotateSteps(['Fry the onions until soft.'], [greenOnions], ['Green onions', 'Yellow onions']);
    expect(step!.segments.every((s) => s.kind === 'plain')).toBe(true);
  });

  it('still matches the full name and its aliases', () => {
    const [step] = annotateSteps(['Scatter green onions and scallions.'], [greenOnions], ['Green onions', 'Yellow onions']);
    expect(step!.segments.filter((s) => s.kind === 'skipped').map((s) => s.text)).toEqual(['green onions', 'scallions']);
  });
});

describe('wordForms', () => {
  it('gives singular and plural spellings', () => {
    expect(wordForms('mangoes')).toEqual(expect.arrayContaining(['mango', 'mangoes']));
    expect(wordForms('tomato')).toEqual(expect.arrayContaining(['tomatoes', 'tomato']));
    expect(wordForms('berries')).toEqual(expect.arrayContaining(['berry', 'berries']));
    expect(wordForms('chilies')).toEqual(expect.arrayContaining(['chili', 'chilies']));
    expect(wordForms('chili')).toEqual(expect.arrayContaining(['chilies']));
  });
});
