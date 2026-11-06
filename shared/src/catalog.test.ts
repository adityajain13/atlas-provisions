import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, INGREDIENTS, INGREDIENT_BY_ID, inSeason } from './catalog';
import { ALLERGEN_PRESETS } from './index';

describe('ingredient catalogue', () => {
  it('has at least 150 items', () => {
    expect(INGREDIENTS.length).toBeGreaterThanOrEqual(150);
  });

  it('has unique kebab-case ids', () => {
    const ids = INGREDIENTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('has lowercase aliases with no empty entries', () => {
    for (const ing of INGREDIENTS) {
      expect(ing.aliases.length, ing.id).toBeGreaterThan(0);
      for (const alias of ing.aliases) {
        expect(alias, `${ing.id}: "${alias}"`).toBe(alias.toLowerCase());
        expect(alias.trim(), `${ing.id}: "${alias}"`).toBe(alias);
        expect(alias.length).toBeGreaterThan(0);
      }
    }
  });

  it('only uses allergens from ALLERGEN_PRESETS', () => {
    const allowed = new Set(ALLERGEN_PRESETS);
    for (const ing of INGREDIENTS) {
      for (const a of ing.allergens) expect(allowed.has(a), `${ing.id}: ${a}`).toBe(true);
    }
  });

  it('gives every category at least one item', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(INGREDIENTS.some((i) => i.category === cat), cat).toBe(true);
    }
  });

  it('has non-negative nutrition with kcal under 900 per 100 g', () => {
    for (const ing of INGREDIENTS) {
      const n = ing.nutritionPer100g;
      for (const [k, v] of Object.entries(n)) {
        expect(v, `${ing.id}.${k}`).toBeGreaterThanOrEqual(0);
      }
      expect(n.kcal, ing.id).toBeLessThan(900);
    }
  });

  it('gives each items a sane weight as sold: one loaf, one dozen eggs, one pack', () => {
    const kg = (id: string) => INGREDIENT_BY_ID[id]?.eachWeightKg;
    expect(kg('white-bread')).toBeGreaterThanOrEqual(0.5);
    expect(kg('white-bread')).toBeLessThanOrEqual(0.8);
    expect(kg('whole-wheat-bread')).toBeGreaterThanOrEqual(0.5);
    expect(kg('whole-wheat-bread')).toBeLessThanOrEqual(0.8);
    expect(kg('eggs-large')).toBeGreaterThanOrEqual(0.6);
    expect(kg('eggs-large')).toBeLessThanOrEqual(0.8);
    expect(kg('flour-tortillas')).toBeGreaterThanOrEqual(0.3);
    expect(kg('flour-tortillas')).toBeLessThanOrEqual(1);
    expect(kg('pita')).toBeGreaterThanOrEqual(0.2);
    expect(kg('pita')).toBeLessThanOrEqual(0.6);
    expect(INGREDIENT_BY_ID['eggs-large']?.eachLabel).toBe('one dozen carton');
  });

  it('indexes every ingredient by id', () => {
    expect(Object.keys(INGREDIENT_BY_ID)).toHaveLength(INGREDIENTS.length);
    expect(INGREDIENT_BY_ID['chicken-thigh-boneless']?.name).toBe('Boneless chicken thighs');
  });

  it('has the expected allergens on key items', () => {
    expect(INGREDIENT_BY_ID['peanut-butter']?.allergens).toContain('peanut');
    expect(INGREDIENT_BY_ID['cheddar']?.allergens).toContain('dairy');
    expect(INGREDIENT_BY_ID['white-bread']?.allergens).toContain('gluten');
    expect(INGREDIENT_BY_ID['soy-sauce']?.allergens).toEqual(expect.arrayContaining(['soy', 'gluten']));
    expect(INGREDIENT_BY_ID['shrimp-raw']?.allergens).toContain('shellfish');
    expect(INGREDIENT_BY_ID['salmon-fillet']?.allergens).toContain('fish');
    expect(INGREDIENT_BY_ID['naan']?.allergens).toEqual(expect.arrayContaining(['gluten', 'dairy']));
    expect(INGREDIENT_BY_ID['eggs-large']?.allergens).toContain('egg');
    expect(INGREDIENT_BY_ID['tofu-firm']?.allergens).toContain('soy');
    expect(INGREDIENT_BY_ID['tahini']?.allergens).toContain('sesame');
    expect(INGREDIENT_BY_ID['pesto']?.allergens).toEqual(expect.arrayContaining(['tree nut', 'dairy']));
  });
});

describe('chili oil and doubanjiang', () => {
  it('are in the catalogue, found by their common names, with cook amounts and prices', () => {
    expect(INGREDIENT_BY_ID['chili-oil']).toMatchObject({ name: 'Chili oil', category: 'pantry' });
    expect(INGREDIENT_BY_ID['doubanjiang']).toMatchObject({ category: 'pantry' });
    expect(INGREDIENTS.find((i) => i.aliases.includes('chili crisp'))?.id).toBe('chili-oil');
    expect(INGREDIENTS.find((i) => i.aliases.includes('chili bean paste'))?.id).toBe('doubanjiang');
    expect(INGREDIENT_BY_ID['chili-oil']!.cook).toBeDefined();
    expect(INGREDIENT_BY_ID['chili-oil']!.typicalPrice).toBeDefined();
  });
});

describe('seasons', () => {
  it('gives Ontario produce its months and flags tropical produce as imported', () => {
    expect(INGREDIENT_BY_ID['strawberries']!.season).toEqual([6, 7]);
    expect(INGREDIENT_BY_ID['mangoes']!.imported).toBe(true);
    expect(INGREDIENT_BY_ID['bananas']!.season).toBeUndefined();
    expect(INGREDIENT_BY_ID['bananas']!.imported).toBeUndefined();
  });

  it('is in season in its months, out of season otherwise, and always in season with no data', () => {
    expect(inSeason(INGREDIENT_BY_ID['zucchini']!, 8)).toBe(true);
    expect(inSeason(INGREDIENT_BY_ID['zucchini']!, 11)).toBe(false);
    expect(inSeason(INGREDIENT_BY_ID['carrots']!, 11)).toBe(true);
    expect(inSeason({}, 1)).toBe(true);
  });
});
