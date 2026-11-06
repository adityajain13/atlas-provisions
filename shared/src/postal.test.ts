import { describe, expect, it } from 'vitest';
import { formatPostalCode, normalizePostalCode } from './flipp';
import { HouseholdSchema, defaultHousehold } from './index';

describe('formatPostalCode', () => {
  it('writes a Canadian postal code as "M5T 1R5"', () => {
    expect(formatPostalCode('m5t1r5')).toBe('M5T 1R5');
    expect(formatPostalCode('M5T-1R5')).toBe('M5T 1R5');
    expect(formatPostalCode(' m5t  1r5 ')).toBe('M5T 1R5');
  });

  it('gives null for anything that is not a postal code', () => {
    expect(formatPostalCode('12345')).toBeNull();
    expect(formatPostalCode('M5T 1R')).toBeNull();
  });

  it('is the spaced form of normalizePostalCode, which flyer lookups keep', () => {
    expect(normalizePostalCode('M5T 1R5')).toBe('M5T1R5');
  });
});

describe('the household postal code', () => {
  const withCode = (postalCode: string) => HouseholdSchema.safeParse({ ...defaultHousehold(), postalCode });

  it('is stored with the space', () => {
    expect(withCode('m5t1r5').data?.postalCode).toBe('M5T 1R5');
    expect(withCode('M5T 1R5').data?.postalCode).toBe('M5T 1R5');
  });

  it('reads a stored code without the space in the spaced form', () => {
    expect(HouseholdSchema.parse({ ...defaultHousehold(), postalCode: 'M5V2T6' }).postalCode).toBe('M5V 2T6');
  });

  it('rejects a code that is not one', () => {
    expect(withCode('12345').success).toBe(false);
  });
});
