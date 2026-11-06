import { describe, expect, it } from 'vitest';
import { INGREDIENT_BY_ID, INGREDIENTS } from './catalog';
import { ALLERGEN_PRESETS, HouseholdSchema, defaultHousehold } from './index';
import {
  CUISINES,
  CUISINE_GROUPS,
  DEFAULT_ON_HAND,
  cuisineKey,
  cuisineLevel,
  cuisineMixOf,
  defaultCuisines,
  regularCandidates,
} from './cuisines';

describe('cuisine list', () => {
  it('has the twenty cuisines, each once, with a group the Household screen knows', () => {
    expect(CUISINES).toHaveLength(20);
    expect(new Set(CUISINES.map((c) => c.key)).size).toBe(CUISINES.length);
    for (const c of CUISINES) expect(CUISINE_GROUPS).toContain(c.group);
  });

  it('names only catalogue ingredients in each cuisine\'s staples and fresh items', () => {
    for (const c of CUISINES) {
      for (const id of [...c.pantry, ...c.fresh]) expect(INGREDIENT_BY_ID[id], `${c.key}: ${id}`).toBeDefined();
      expect(c.pantry.length, `${c.key} pantry`).toBeGreaterThan(0);
      expect(c.fresh.length, `${c.key} fresh`).toBeGreaterThan(0);
    }
  });

  it('starts Indian, Indonesian, Hakka and Italian as often, and the rest as sometimes', () => {
    const levels = defaultCuisines();
    for (const c of CUISINES) {
      const expected = ['indian', 'indonesian', 'hakka', 'italian'].includes(c.key) ? 'often' : 'sometimes';
      expect(levels[c.key], c.key).toBe(expected);
    }
  });
});

describe('cuisine levels', () => {
  it('reads a missing cuisine as its default, and a stored one as stored', () => {
    expect(cuisineLevel({}, 'indian')).toBe('often');
    expect(cuisineLevel({}, 'thai')).toBe('sometimes');
    expect(cuisineLevel({ thai: 'never' }, 'thai')).toBe('never');
    expect(cuisineLevel(undefined, 'unknown-cuisine')).toBe('sometimes');
  });

  it('lists every cuisine once, at its level, in the planner\'s mix', () => {
    const mix = cuisineMixOf({ indian: 'never', thai: 'often' });
    expect(mix.never).toEqual(['indian']);
    expect(mix.often).toContain('thai');
    expect(mix.often).toContain('indonesian');
    const all = [...mix.often, ...mix.sometimes, ...mix.rarely, ...mix.never];
    expect(all.sort()).toEqual(CUISINES.map((c) => c.key).sort());
  });

  it('accepts a cuisine key or label, in any case, and nothing else', () => {
    expect(cuisineKey('indian')).toBe('indian');
    expect(cuisineKey('Hakka (Indo-Chinese)')).toBe('hakka');
    expect(cuisineKey('THAI')).toBe('thai');
    expect(cuisineKey('Klingon')).toBeUndefined();
    expect(cuisineKey(undefined)).toBeUndefined();
  });
});

describe('regularCandidates', () => {
  it('draws from the often cuisines first, fresh before pantry, and never from rarely or never cuisines', () => {
    const levels = { ...defaultCuisines(), thai: 'rarely' as const };
    const out = regularCandidates(levels, new Set(), 200);
    const indianFirst = INGREDIENT_BY_ID['paneer'] ? out.indexOf('paneer') : -1;
    expect(indianFirst).toBe(0);
    expect(out).not.toContain('curry-paste-green');
    expect(out).toContain('garam-masala');
  });

  it('caps at the limit and skips excluded ids', () => {
    const out = regularCandidates(defaultCuisines(), new Set(['paneer']), 40);
    expect(out).toHaveLength(40);
    expect(out).not.toContain('paneer');
    expect(new Set(out).size).toBe(out.length);
  });

  it('returns nothing when every cuisine is rarely or never', () => {
    const levels = Object.fromEntries(CUISINES.map((c) => [c.key, 'never' as const]));
    expect(regularCandidates(levels, new Set())).toEqual([]);
  });
});

describe('household fields', () => {
  it('defaults cuisines and on-hand staples, and parses a household stored before they existed', () => {
    const old: Record<string, unknown> = { ...defaultHousehold() };
    delete old.cuisines;
    delete old.onHand;
    const parsed = HouseholdSchema.parse(old);
    expect(parsed.cuisines).toEqual(defaultCuisines());
    expect(parsed.onHand).toEqual(DEFAULT_ON_HAND);
  });

  it('starts with a modest set of common spices and condiments, none of them salt', () => {
    expect(DEFAULT_ON_HAND.length).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_ON_HAND.length).toBeLessThanOrEqual(12);
    for (const id of DEFAULT_ON_HAND) expect(INGREDIENT_BY_ID[id], id).toBeDefined();
    expect(DEFAULT_ON_HAND).not.toContain('salt');
  });
});

describe('catalogue additions for cuisines', () => {
  it('has the cuisine staples the planner needs', () => {
    for (const id of ['garam-masala', 'paneer', 'tempeh', 'lemongrass', 'kecap-manis', 'gochujang', 'tahini', 'masa-harina', 'bok-choy']) {
      expect(INGREDIENT_BY_ID[id], id).toBeDefined();
    }
    expect(INGREDIENTS.length).toBeGreaterThanOrEqual(280);
  });

  it('gives every ingredient a typical price, positive, with a pack size for packs', () => {
    for (const ing of INGREDIENTS) {
      const t = ing.typicalPrice;
      expect(t, ing.id).toBeDefined();
      expect(t!.price, ing.id).toBeGreaterThan(0);
      if (t!.per === 'pack') expect(t!.packQty ?? 0, ing.id).toBeGreaterThan(0);
    }
  });

  it('uses only allergens from the presets for the new items', () => {
    const allowed = new Set(ALLERGEN_PRESETS);
    for (const id of ['ghee', 'fish-sauce', 'oyster-sauce', 'kecap-manis', 'tempeh', 'kimchi', 'sesame-oil']) {
      for (const a of INGREDIENT_BY_ID[id]!.allergens) expect(allowed.has(a), `${id}: ${a}`).toBe(true);
    }
  });
});
