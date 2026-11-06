import { describe, expect, it } from 'vitest';
import { INGREDIENTS, INGREDIENT_BY_ID } from './catalog';
import { ItemRuleSchema } from './index';
import { alwaysBuyId, blockedIds, expandRule, nameHasWord } from './itemRules';

const withProtein = (tag: string) => INGREDIENTS.filter((i) => i.protein === tag).map((i) => i.id);

describe('expandRule: the household terms', () => {
  it('beef covers every beef-tagged ingredient and nothing else', () => {
    expect(expandRule('beef')).toEqual(['ground-beef', 'beef-stewing-cubes', 'sirloin-steak']);
  });

  it('pork covers every pork-tagged ingredient, sausage and deli pork included', () => {
    const pork = expandRule('pork');
    for (const id of ['ground-pork', 'pork-chops', 'pork-tenderloin', 'italian-sausage']) expect(pork).toContain(id);
    expect(pork).toEqual(withProtein('pork'));
  });

  it('corn covers the corn items: cobs, frozen, canned, tortillas and chips, but not the processed cornstarch, polenta or masa harina', () => {
    const corn = ['corn-cobs', 'frozen-corn', 'canned-corn', 'corn-tortillas', 'tortilla-chips'];
    expect([...expandRule('corn')].sort()).toEqual([...corn].sort());
  });

  it('a rule that names a derived food still covers it: cornstarch, polenta and masa harina', () => {
    expect(expandRule('cornstarch')).toEqual(['cornstarch']);
    expect(expandRule('corn starch')).toEqual(['cornstarch']);
    expect(expandRule('polenta')).toEqual(['polenta']);
    expect(expandRule('masa')).toEqual(['masa-harina']);
    expect(expandRule('cornmeal')).toEqual(['polenta']);
  });

  it('a plain word matches an exact alias even when the ingredient name is derived: tortillas covers flour tortillas', () => {
    expect(expandRule('tortillas')).toEqual(expect.arrayContaining(['flour-tortillas', 'corn-tortillas']));
  });

  it('oats covers every oats ingredient', () => {
    expect(expandRule('oats')).toEqual(['rolled-oats']);
  });

  it('green peas covers frozen peas', () => {
    expect(expandRule('green peas')).toEqual(['frozen-peas']);
  });

  it('a plural protein word folds to its tag: eggs covers every egg-tagged ingredient', () => {
    expect(expandRule('eggs')).toEqual(expect.arrayContaining(withProtein('egg')));
  });

  it('a whole word in an alias counts too: eggs also covers egg noodles', () => {
    expect(expandRule('eggs')).toContain('egg-noodles');
  });
});

describe('expandRule: matching rules', () => {
  it('matches whole words only: popcorn is not corn', () => {
    expect(expandRule('popcorn')).toEqual([]);
  });

  it('returns nothing for an empty or unknown name', () => {
    expect(expandRule('')).toEqual([]);
    expect(expandRule('   ')).toEqual([]);
    expect(expandRule('zzzz unknown food')).toEqual([]);
  });

  it('returns ids in catalogue order, each once', () => {
    const ids = expandRule('chicken');
    expect(new Set(ids).size).toBe(ids.length);
    const order = INGREDIENTS.map((i) => i.id);
    expect([...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(ids);
  });

  it('every id it returns is in the catalogue', () => {
    for (const term of ['beef', 'pork', 'corn', 'oats', 'green peas', 'eggs']) {
      for (const id of expandRule(term)) expect(INGREDIENT_BY_ID[id]).toBeDefined();
    }
  });
});

describe('blockedIds', () => {
  it('blocks the whole expansion when nothing is un-ticked', () => {
    expect(blockedIds({ name: 'beef' })).toEqual(expandRule('beef'));
  });

  it('leaves out the ingredients the household un-ticked', () => {
    expect(blockedIds({ name: 'beef', except: ['sirloin-steak'] })).toEqual(['ground-beef', 'beef-stewing-cubes']);
  });

  it('ignores except ids that are not in the expansion', () => {
    expect(blockedIds({ name: 'oats', except: ['frozen-peas'] })).toEqual(['rolled-oats']);
  });
});

describe('alwaysBuyId', () => {
  it('takes the best match for the name', () => {
    expect(alwaysBuyId('oats')).toBe('rolled-oats');
  });

  it('falls back to the first ingredient a family name covers', () => {
    const id = alwaysBuyId('seafood');
    expect(id).toBeDefined();
    expect(id).toBe(expandRule('seafood')[0]);
  });

  it('is undefined when nothing in the catalogue fits', () => {
    expect(alwaysBuyId('zzzz unknown food')).toBeUndefined();
  });
});

describe('nameHasWord', () => {
  it('finds a whole word in a meal name, ignoring case', () => {
    expect(nameHasWord('Beef stir-fry', 'beef')).toBe(true);
    expect(nameHasWord('Crispy PORK belly', 'pork')).toBe(true);
  });

  it('does not find a word inside another word', () => {
    expect(nameHasWord('Beefy chili', 'beef')).toBe(false);
    expect(nameHasWord('Popcorn chicken', 'corn')).toBe(false);
  });

  it('folds plurals on both sides: pork chops has pork, oatmeal does not have oats', () => {
    expect(nameHasWord('Pork chops and rice', 'pork')).toBe(true);
    expect(nameHasWord('Chops', 'chop')).toBe(true);
    expect(nameHasWord('Oatmeal bowl', 'oats')).toBe(false);
  });

  it('matches a multi-word rule in order', () => {
    expect(nameHasWord('Green peas and rice', 'green peas')).toBe(true);
    expect(nameHasWord('Peas with green sauce', 'green peas')).toBe(false);
  });

  it('is false for an empty word', () => {
    expect(nameHasWord('Beef stir-fry', '  ')).toBe(false);
  });
});

describe('the rule schema', () => {
  it('parses a stored rule with no except list, and one with it', () => {
    expect(ItemRuleSchema.parse({ id: 'a', name: 'beef', rule: 'never' })).toEqual({ id: 'a', name: 'beef', rule: 'never' });
    expect(ItemRuleSchema.parse({ id: 'a', name: 'beef', rule: 'never', except: ['sirloin-steak'] }).except).toEqual(['sirloin-steak']);
  });
});
