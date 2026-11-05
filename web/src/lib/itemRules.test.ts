import { describe, expect, it } from 'vitest';
import { EMPTY_EXPANSION_TEXT, alwaysMatchName, exceptAfter, neverChipLabel, neverExpansion } from './itemRules';

describe('neverChipLabel', () => {
  it('counts the blocked items, in the singular for one', () => {
    expect(neverChipLabel('beef', 3)).toBe('beef · 3 items');
    expect(neverChipLabel('green peas', 1)).toBe('green peas · 1 item');
    expect(neverChipLabel('oats', 0)).toBe('oats · 0 items');
  });
});

describe('alwaysMatchName', () => {
  it('gives the catalogue name the always-buy name stands for', () => {
    expect(alwaysMatchName('oats')).toBe('Rolled oats');
  });

  it('is null when nothing in the catalogue matches', () => {
    expect(alwaysMatchName('zzzz unknown food')).toBeNull();
  });
});

describe('neverExpansion', () => {
  it('lists the covered ingredients, all blocked when nothing is un-ticked', () => {
    const rows = neverExpansion({ name: 'oats' });
    expect(rows).toEqual([{ id: 'rolled-oats', name: 'Rolled oats', blocked: true }]);
  });

  it('marks an un-ticked ingredient as not blocked', () => {
    const rows = neverExpansion({ name: 'beef', except: ['sirloin-steak'] });
    expect(rows.find((r) => r.id === 'sirloin-steak')).toMatchObject({ blocked: false });
    expect(rows.filter((r) => r.blocked).map((r) => r.id)).toEqual(['ground-beef', 'beef-stewing-cubes']);
  });

  it('is empty for a name that matches nothing, which the inset explains', () => {
    expect(neverExpansion({ name: 'zzzz unknown food' })).toEqual([]);
    expect(EMPTY_EXPANSION_TEXT).toContain('still blocked');
  });
});

describe('exceptAfter', () => {
  it('adds an un-ticked ingredient to the list', () => {
    expect(exceptAfter(undefined, 'sirloin-steak', false)).toEqual(['sirloin-steak']);
    expect(exceptAfter(['ground-beef'], 'sirloin-steak', false)).toEqual(['ground-beef', 'sirloin-steak']);
  });

  it('removes a ticked ingredient from the list, and drops an empty list', () => {
    expect(exceptAfter(['sirloin-steak'], 'sirloin-steak', true)).toBeUndefined();
    expect(exceptAfter(['ground-beef', 'sirloin-steak'], 'sirloin-steak', true)).toEqual(['ground-beef']);
  });

  it('does not repeat an id that is already un-ticked', () => {
    expect(exceptAfter(['sirloin-steak'], 'sirloin-steak', false)).toEqual(['sirloin-steak']);
  });
});
