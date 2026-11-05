import { describe, expect, it } from 'vitest';
import { isViewableWeek, planLabel, planTitle, weekCaption, weekOffset, weekPhrase } from './week';

// Thursday 2026-11-05: this week is Sunday 2026-11-01.
const CURRENT = '2026-11-01';

describe('weekOffset', () => {
  it('counts whole weeks from the current plan week', () => {
    expect(weekOffset('2026-11-01', CURRENT)).toBe(0);
    expect(weekOffset('2026-11-08', CURRENT)).toBe(1);
    expect(weekOffset('2026-10-18', CURRENT)).toBe(-2);
    expect(weekOffset('2027-01-03', CURRENT)).toBe(9);
  });
});

describe('isViewableWeek', () => {
  it('allows eight weeks back to two weeks ahead, on Sundays only', () => {
    expect(isViewableWeek('2026-09-06', CURRENT)).toBe(true); // 8 weeks back
    expect(isViewableWeek('2026-11-15', CURRENT)).toBe(true); // 2 ahead
    expect(isViewableWeek('2026-09-13', CURRENT)).toBe(true);
    expect(isViewableWeek('2026-09-05', CURRENT)).toBe(false); // a Saturday, 9 weeks back
    expect(isViewableWeek('2026-11-22', CURRENT)).toBe(false); // 3 ahead
    expect(isViewableWeek('2026-11-08x', CURRENT)).toBe(false);
    expect(isViewableWeek('2026-02-30', CURRENT)).toBe(false);
  });
});

describe('planLabel and planTitle', () => {
  it('names this week, next week, and other weeks by their dates', () => {
    expect(planLabel(CURRENT, CURRENT, false)).toBe('Plan this week');
    expect(planLabel('2026-11-08', CURRENT, false)).toBe('Plan next week');
    expect(planLabel('2026-11-15', CURRENT, false)).toBe('Plan the week of Nov 15–21');
    expect(planTitle('2026-11-22', CURRENT)).toBe('Plan the week of Nov 22–28');
  });

  it('says Re-plan when the week already has a plan', () => {
    expect(planLabel(CURRENT, CURRENT, true)).toBe('Re-plan this week');
    expect(planLabel('2026-11-08', CURRENT, true)).toBe('Re-plan next week');
  });
});

describe('weekCaption and weekPhrase', () => {
  it('describes the offset in words', () => {
    expect(weekCaption(CURRENT, CURRENT)).toBe('This week');
    expect(weekCaption('2026-11-08', CURRENT)).toBe('Next week');
    expect(weekCaption('2026-10-25', CURRENT)).toBe('Last week');
    expect(weekCaption('2026-11-15', CURRENT)).toBe('In 2 weeks');
    expect(weekCaption('2026-10-18', CURRENT)).toBe('2 weeks ago');
    expect(weekPhrase('2026-11-08', CURRENT)).toBe('next week');
    expect(weekPhrase('2026-11-22', CURRENT)).toBe('the week of Nov 22–28');
  });
});
