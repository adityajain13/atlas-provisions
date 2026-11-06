import { describe, expect, it } from 'vitest';
import { INGREDIENT_BY_ID } from './catalog';
import { FORM_GROUPS, allowedForms, blockedFormIds, formGroupOf, formOf, formsAllowedFor } from './forms';
import { DEFAULT_STORAGE } from './storage';
import { HouseholdSchema, defaultHousehold } from './index';

const group = (key: string) => FORM_GROUPS.find((g) => g.key === key)!;

describe('form groups', () => {
  it('builds the five groups from the catalogue tags, with the forms each has', () => {
    expect(FORM_GROUPS.map((g) => g.key)).toEqual(['fish', 'beans', 'vegetables', 'tomatoes', 'fruit']);
    expect(group('fish').forms).toEqual(['fresh', 'frozen', 'canned']);
    expect(group('beans').forms).toEqual(['canned', 'dry']);
    expect(group('vegetables').forms).toEqual(['fresh', 'frozen', 'canned']);
    expect(group('tomatoes').forms).toEqual(['fresh', 'canned']);
    expect(group('fruit').forms).toEqual(['fresh', 'frozen']);
  });

  it('puts canned salmon and canned tuna in fish, and dry lentils in beans', () => {
    expect(group('fish').members.canned).toEqual(expect.arrayContaining(['canned-tuna', 'canned-salmon']));
    expect(group('beans').members.dry).toEqual(expect.arrayContaining(['lentils-red-dry', 'chickpeas-dry']));
  });

  it('reads a form and group from each tagged catalogue entry', () => {
    expect(formOf('canned-tuna')).toBe('canned');
    expect(formGroupOf('canned-tuna')).toBe('fish');
    expect(formOf('frozen-peas')).toBe('frozen');
  });

  it('leaves untagged ingredients alone', () => {
    expect(formOf('broccoli-untagged-check')).toBeUndefined();
    expect(INGREDIENT_BY_ID['chicken-breast-boneless']?.form).toBeUndefined();
  });
});

describe('allowedForms and blockedFormIds', () => {
  it('keeps every form of a group when nothing is stored, or the stored list is empty', () => {
    expect(allowedForms(undefined, 'fish')).toEqual(['fresh', 'frozen', 'canned']);
    expect(allowedForms({}, 'fish')).toEqual(['fresh', 'frozen', 'canned']);
    expect(allowedForms({ fish: [] }, 'fish')).toEqual(['fresh', 'frozen', 'canned']);
  });

  it('limits a group to the stored forms that the group has', () => {
    expect(allowedForms({ fish: ['frozen', 'canned', 'dry'] }, 'fish')).toEqual(['frozen', 'canned']);
  });

  it('blocks the catalogue ids of every form the household does not keep', () => {
    const blocked = blockedFormIds({ fish: ['fresh', 'frozen'] });
    expect(blocked.has('canned-tuna')).toBe(true);
    expect(blocked.has('canned-salmon')).toBe(true);
    expect(blocked.has('salmon-fillet')).toBe(false);
    expect(blocked.has('frozen-shrimp')).toBe(false);
    expect(blocked.has('canned-diced-tomatoes')).toBe(false);
  });

  it('blocks nothing when every form is kept', () => {
    expect(blockedFormIds(undefined).size).toBe(0);
  });

  it('gives the payload every group with the forms it keeps', () => {
    const out = formsAllowedFor({ beans: ['dry'] });
    expect(out.beans).toEqual(['dry']);
    expect(out.fish).toEqual(['fresh', 'frozen', 'canned']);
    expect(Object.keys(out).sort()).toEqual(['beans', 'fish', 'fruit', 'tomatoes', 'vegetables']);
  });
});

describe('household schema for forms, storage and dishes', () => {
  it('fills the new fields with defaults for a household saved before they existed', () => {
    const { forms: _f, storage: _s, avoidDishes: _a, ...older } = defaultHousehold();
    const parsed = HouseholdSchema.parse(older);
    expect(parsed.forms).toEqual({});
    expect(parsed.avoidDishes).toEqual([]);
    expect(parsed.storage).toEqual(DEFAULT_STORAGE);
  });

  it('keeps the stored values when they are set', () => {
    const parsed = HouseholdSchema.parse({
      ...defaultHousehold(),
      forms: { fish: ['frozen'] },
      avoidDishes: ['slaw'],
      storage: { containers: 'few', freezer: false, zipBags: false },
    });
    expect(parsed.forms.fish).toEqual(['frozen']);
    expect(parsed.avoidDishes).toEqual(['slaw']);
    expect(parsed.storage).toEqual({ containers: 'few', freezer: false, zipBags: false });
  });

  it('rejects a storage level that is not one of the four', () => {
    const bad = { ...defaultHousehold(), storage: { containers: 'lots', freezer: true, zipBags: true } };
    expect(HouseholdSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a form that is not fresh, frozen, canned or dry', () => {
    expect(HouseholdSchema.safeParse({ ...defaultHousehold(), forms: { fish: ['smoked'] } }).success).toBe(false);
  });
});
