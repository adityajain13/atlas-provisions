// The store number a person types for a Loblaw-family store. Pure: no DOM.
import { describe, expect, it } from 'vitest';
import { storeNumberOf } from './SiteLocation';

describe('storeNumberOf', () => {
  it('takes exactly four digits, with spaces around them ignored', () => {
    expect(storeNumberOf('1234')).toBe('1234');
    expect(storeNumberOf('  0456 ')).toBe('0456');
  });

  it('refuses anything that is not four digits', () => {
    expect(storeNumberOf('')).toBeNull();
    expect(storeNumberOf('123')).toBeNull();
    expect(storeNumberOf('12345')).toBeNull();
    expect(storeNumberOf('12a4')).toBeNull();
    expect(storeNumberOf('12 34')).toBeNull();
  });
});
