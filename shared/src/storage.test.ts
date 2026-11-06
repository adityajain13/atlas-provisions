import { describe, expect, it } from 'vitest';
import { DEFAULT_STORAGE, StorageSchema } from './storage';
import { HouseholdSchema, defaultHousehold } from './index';

describe('storage with freezer ziplock bags', () => {
  it('defaults to every storage item on', () => {
    expect(DEFAULT_STORAGE).toEqual({ containers: 'some', freezer: true, zipBags: true, freezerBags: true });
  });

  it('gives a household stored before freezerBags the zip bags value it had', () => {
    expect(StorageSchema.parse({ containers: 'few', freezer: true, zipBags: false }).freezerBags).toBe(false);
    expect(StorageSchema.parse({ containers: 'few', freezer: true, zipBags: true }).freezerBags).toBe(true);
  });

  it('keeps a stored freezerBags as it is, whatever zipBags says', () => {
    expect(StorageSchema.parse({ containers: 'few', freezer: true, zipBags: true, freezerBags: false }).freezerBags).toBe(false);
  });

  it('fills in the storage of a household saved without it', () => {
    const { storage: _s, ...older } = defaultHousehold();
    expect(HouseholdSchema.parse(older).storage).toEqual(DEFAULT_STORAGE);
  });
});
