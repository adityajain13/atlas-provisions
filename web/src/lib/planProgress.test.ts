import { describe, expect, it } from 'vitest';
import { progressText, timingLine, WAITING_TEXT } from './planProgress';

describe('progressText', () => {
  it('names each stage in words', () => {
    expect(progressText({ stage: 'writing', attempt: 1 })).toBe('Writing meals…');
    expect(progressText({ stage: 'checking', attempt: 1 })).toBe('Checking budget and allergies…');
    expect(progressText({ stage: 'saving' })).toBe('Saving…');
  });

  it('says how many meals are being fixed, and why', () => {
    expect(progressText({ stage: 'fixing', attempt: 2, meals: 2, reason: 'budget' })).toBe('Fixing 2 meals (over budget)…');
    expect(progressText({ stage: 'fixing', attempt: 2, meals: 1, reason: 'allergen' })).toBe('Fixing 1 meal (an allergy)…');
  });

  it('shows an unknown reason by its name', () => {
    expect(progressText({ stage: 'fixing', attempt: 3, meals: 3, reason: 'made-up-check' })).toBe('Fixing 3 meals (made-up-check)…');
  });

  it('has the waiting text for before the first stage', () => {
    expect(WAITING_TEXT).toBe('This can take up to a minute.');
  });
});

describe('timingLine', () => {
  it('reads the total time and the attempts', () => {
    expect(timingLine({ totalMs: 48_400, attempts: [{ ms: 20_000, mode: 'full', replaced: 21, errors: 1 }, { ms: 28_000, mode: 'repair', replaced: 2, errors: 0 }] })).toBe(
      'Planned in 48 s · 2 attempts',
    );
  });

  it('uses the singular for one attempt, and says so when it was quick', () => {
    expect(timingLine({ totalMs: 900, attempts: [{ ms: 900, mode: 'full', replaced: 21, errors: 0 }] })).toBe('Planned in under a second · 1 attempt');
  });

  it('is absent for a plan with no timings', () => {
    expect(timingLine(undefined)).toBeNull();
  });
});
