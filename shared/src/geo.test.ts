// Distances and postal-code placement without a geocoder. Pure: no network.
import { describe, expect, it } from 'vitest';
import { estimatePostalPoint, haversineKm, looksLikePostal, roundKm, type PostalSample } from './geo';

const SAMPLES: PostalSample[] = [
  { postalCode: 'M5S1W7', lat: 43.66, lng: -79.4 },
  { postalCode: 'M5V3K3', lat: 43.64, lng: -79.4 },
  { postalCode: 'M6G3H4', lat: 43.67, lng: -79.42 },
  { postalCode: 'M4Y1A6', lat: 43.66, lng: -79.38 },
];

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm({ lat: 43.65, lng: -79.38 }, { lat: 43.65, lng: -79.38 })).toBe(0);
  });

  it('measures about 0.11 degrees of latitude as about 12 km', () => {
    expect(roundKm(haversineKm({ lat: 43.6, lng: -79.4 }, { lat: 43.71, lng: -79.4 }))).toBe(12.2);
  });

  it('is symmetric', () => {
    const a = { lat: 43.65, lng: -79.38 };
    const b = { lat: 43.77, lng: -79.26 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe('roundKm', () => {
  it('rounds to a tenth of a kilometre', () => {
    expect(roundKm(2.149)).toBe(2.1);
    expect(roundKm(2.15)).toBe(2.2);
  });
});

describe('looksLikePostal', () => {
  it('takes a full postal code with or without the space, and the first three characters', () => {
    expect(looksLikePostal('M5T 1R5')).toBe(true);
    expect(looksLikePostal('m5t1r5')).toBe(true);
    expect(looksLikePostal('M5T')).toBe(true);
    expect(looksLikePostal('  M5T  ')).toBe(true);
  });

  it('refuses words, street names and partial codes that are not three characters', () => {
    expect(looksLikePostal('Mississauga')).toBe(false);
    expect(looksLikePostal('Bloor St')).toBe(false);
    expect(looksLikePostal('M5')).toBe(false);
    expect(looksLikePostal('')).toBe(false);
  });
});

describe('estimatePostalPoint', () => {
  it('averages the known points that share the three-character prefix, and is exact about it', () => {
    const near = estimatePostalPoint('M5S 9Z9', [...SAMPLES, { postalCode: 'M5S2A1', lat: 43.7, lng: -79.5 }]);
    expect(near).toEqual({ lat: (43.66 + 43.7) / 2, lng: (-79.4 + -79.5) / 2, approx: false });
  });

  it('ignores spaces and case in the postal code and in the samples', () => {
    const got = estimatePostalPoint('m5s 1w7', [{ postalCode: 'm5s 1w7', lat: 43.66, lng: -79.4 }]);
    expect(got).toEqual({ lat: 43.66, lng: -79.4, approx: false });
  });

  it('falls back to two characters, and marks the estimate approximate', () => {
    const got = estimatePostalPoint('M5T 1R5', SAMPLES);
    expect(got).not.toBeNull();
    expect(got!.approx).toBe(true);
    const m5 = SAMPLES.filter((s) => s.postalCode.startsWith('M5'));
    expect(got!.lat).toBeCloseTo(m5.reduce((t, s) => t + s.lat, 0) / m5.length, 9);
    expect(got!.lng).toBeCloseTo(m5.reduce((t, s) => t + s.lng, 0) / m5.length, 9);
  });

  it('falls back to one character, and is approximate', () => {
    const got = estimatePostalPoint('K1A0B1', SAMPLES);
    expect(got).toBeNull();
    const oneLetter = estimatePostalPoint('M9X', SAMPLES);
    expect(oneLetter).toMatchObject({ approx: true });
  });

  it('returns null with no samples, an empty postal code, or no sample that shares the first letter', () => {
    expect(estimatePostalPoint('M5T 1R5', [])).toBeNull();
    expect(estimatePostalPoint('', SAMPLES)).toBeNull();
    expect(estimatePostalPoint('K1A 0B1', SAMPLES)).toBeNull();
  });

  it('does not use a sample with a shorter code as a three-character match', () => {
    const got = estimatePostalPoint('M5T', [{ postalCode: 'M5', lat: 1, lng: 1 }]);
    expect(got).toEqual({ lat: 1, lng: 1, approx: true });
  });
});
