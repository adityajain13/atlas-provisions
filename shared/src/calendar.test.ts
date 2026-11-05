import { describe, expect, it } from 'vitest';
import { addWeeks, isSunday, weekRangeLabel, weekShortRange } from './calendar';
import { isPlannableWeek, retentionCutoff } from './plan';

describe('addWeeks', () => {
  it('moves by whole weeks, across months and years', () => {
    expect(addWeeks('2026-11-01', 1)).toBe('2026-11-08');
    expect(addWeeks('2026-11-29', 1)).toBe('2026-12-06');
    expect(addWeeks('2026-12-27', 1)).toBe('2027-01-03');
    expect(addWeeks('2026-11-01', -2)).toBe('2026-10-18');
    expect(addWeeks('2026-11-01', 0)).toBe('2026-11-01');
  });
});

describe('isSunday', () => {
  it('is true only for Sundays', () => {
    expect(isSunday('2026-11-01')).toBe(true);
    expect(isSunday('2026-11-02')).toBe(false);
    expect(isSunday('2026-11-07')).toBe(false);
  });
});

describe('weekRangeLabel', () => {
  it('names the weekdays and omits the year in the current year', () => {
    expect(weekRangeLabel('2026-11-08', '2026-11-05')).toBe('Sun Nov 8 – Sat Nov 14');
  });

  it('adds the year when the week is not in the current year', () => {
    expect(weekRangeLabel('2027-01-03', '2026-11-05')).toBe('Sun Jan 3, 2027 – Sat Jan 9, 2027');
    expect(weekRangeLabel('2026-12-27', '2026-11-05')).toBe('Sun Dec 27 – Sat Jan 2, 2027');
  });
});

describe('weekShortRange', () => {
  it('gives day numbers within one month', () => {
    expect(weekShortRange('2026-11-22', '2026-11-05')).toBe('Nov 22–28');
  });

  it('gives both months across a month boundary', () => {
    expect(weekShortRange('2026-11-29', '2026-11-05')).toBe('Nov 29 – Dec 5');
  });

  it('adds the year outside the current year', () => {
    expect(weekShortRange('2027-01-03', '2026-11-05')).toBe('Jan 3–9, 2027');
  });
});

describe('isPlannableWeek', () => {
  // Thursday 2026-11-05, so the current plan week starts Sunday 2026-11-01.
  const now = new Date('2026-11-05T17:00:00Z');

  it('allows this week and up to two weeks ahead', () => {
    expect(isPlannableWeek('2026-11-01', now)).toBe(true);
    expect(isPlannableWeek('2026-11-08', now)).toBe(true);
    expect(isPlannableWeek('2026-11-15', now)).toBe(true);
  });

  it('refuses past weeks and weeks beyond the window', () => {
    expect(isPlannableWeek('2026-10-25', now)).toBe(false);
    expect(isPlannableWeek('2026-11-22', now)).toBe(false);
  });

  it('refuses a date that is not a Sunday', () => {
    expect(isPlannableWeek('2026-11-09', now)).toBe(false);
  });
});

describe('retentionCutoff', () => {
  it('is twelve weeks before the current plan week', () => {
    // Current plan week 2026-11-01; twelve weeks earlier is 2026-08-09.
    expect(retentionCutoff(new Date('2026-11-05T17:00:00Z'))).toBe('2026-08-09');
  });
});
