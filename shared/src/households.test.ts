import { describe, expect, it } from 'vitest';
import {
  cleanEmail,
  cleanHouseholdName,
  defaultHouseholdName,
  longDate,
  nextMonthStart,
  parseCap,
  usageCapsFrom,
  usageLimitMessage,
  usageLine,
  usageMonth,
} from './households';

describe('parseCap', () => {
  it('takes a whole number of zero or more, and keeps the fallback for anything else', () => {
    expect(parseCap('0', 30)).toBe(0);
    expect(parseCap(' 12 ', 30)).toBe(12);
    expect(parseCap(undefined, 30)).toBe(30);
    expect(parseCap('', 30)).toBe(30);
    expect(parseCap('-1', 30)).toBe(30);
    expect(parseCap('2.5', 30)).toBe(30);
    expect(parseCap('twenty', 30)).toBe(30);
  });
});

describe('usageCapsFrom', () => {
  it('reads the three env vars, with defaults of 20, 30 and 30', () => {
    expect(usageCapsFrom({})).toEqual({ plan: 20, receipt: 30, prep: 30 });
    expect(usageCapsFrom({ PLAN_CAP_MONTHLY: '5', RECEIPT_CAP_MONTHLY: '0', PREP_CAP_MONTHLY: 'x' })).toEqual({
      plan: 5,
      receipt: 0,
      prep: 30,
    });
  });
});

describe('months', () => {
  it('takes the month of a Toronto day', () => {
    expect(usageMonth('2026-11-05')).toBe('2026-11');
  });

  it('gives the first day of the next month, across a year end', () => {
    expect(nextMonthStart('2026-11')).toBe('2026-12-01');
    expect(nextMonthStart('2026-12')).toBe('2027-01-01');
    expect(nextMonthStart('2026-02')).toBe('2026-03-01');
  });

  it('writes a date in words', () => {
    expect(longDate('2026-12-01')).toBe('December 1, 2026');
  });
});

describe('usage messages', () => {
  it('names the cap and the reset date', () => {
    expect(usageLimitMessage('plan', 20, '2026-11')).toBe(
      'This household has used its 20 plans for this month. Resets on December 1, 2026.',
    );
    expect(usageLimitMessage('plan', 1, '2026-11')).toBe(
      'This household has used its 1 plan for this month. Resets on December 1, 2026.',
    );
    expect(usageLimitMessage('receipt', 30, '2026-12')).toBe(
      'This household has used its 30 receipt scans for this month. Resets on January 1, 2027.',
    );
  });

  it('lists the month’s use against the caps', () => {
    expect(usageLine({ plan: 3, receipt: 2, prep: 0 }, { plan: 20, receipt: 30, prep: 30 })).toBe(
      'This month: 3 of 20 plans · 2 of 30 receipt scans · 0 of 30 prep refreshes',
    );
    expect(usageLine({ plan: 1, receipt: 0, prep: 0 }, { plan: 1, receipt: 30, prep: 30 })).toBe(
      'This month: 1 of 1 plan · 0 of 30 receipt scans · 0 of 30 prep refreshes',
    );
  });
});

describe('addresses and names', () => {
  it('trims and lower-cases an address, and rejects anything that is not one', () => {
    expect(cleanEmail('  Owner@Example.COM ')).toBe('owner@example.com');
    expect(cleanEmail('no-at-sign')).toBeNull();
    expect(cleanEmail('a b@example.com')).toBeNull();
    expect(cleanEmail(42)).toBeNull();
    expect(cleanEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
  });

  it('trims a household name and keeps it to 60 characters', () => {
    expect(cleanHouseholdName('  The Smiths ')).toBe('The Smiths');
    expect(cleanHouseholdName('   ')).toBeNull();
    expect(cleanHouseholdName('x'.repeat(61))).toBeNull();
    expect(cleanHouseholdName('x'.repeat(60))).toHaveLength(60);
  });

  it('names a new household after the address', () => {
    expect(defaultHouseholdName('alex@example.com')).toBe("alex's household");
  });
});
