import { describe, expect, it } from 'vitest';
import { DAYS, SLOTS, defaultCuisines, defaultHousehold, type Household } from '@provisions/shared';
import { canAdvance, clampStep, stepDone } from './setupSteps';

const person = { id: 'ann', name: 'Ann', dietTags: [], allergies: [] };

/** Every meal on, as a new person starts out. */
function allOn(): Household['schedule'][string] {
  return Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, true]))])) as Household['schedule'][string];
}

function fresh(over: Partial<Household> = {}): Household {
  return { ...defaultHousehold(), ...over };
}

describe('stepDone', () => {
  it('has nothing done on a fresh household', () => {
    const h = fresh();
    for (const step of [2, 3, 4, 5, 6, 7]) expect(stepDone(h, step)).toBe(false);
  });

  it('marks people done once anyone is added', () => {
    expect(stepDone(fresh({ people: [person] }), 2)).toBe(true);
  });

  it('marks meals and schedule done once a meal is turned off, or the prep day changes', () => {
    expect(stepDone(fresh({ people: [person], schedule: { ann: allOn() } }), 3)).toBe(false);
    const off = allOn();
    off.mon = { ...off.mon, breakfast: false };
    expect(stepDone(fresh({ people: [person], schedule: { ann: off } }), 3)).toBe(true);
    expect(stepDone(fresh({ prepDay: null }), 3)).toBe(true);
    expect(stepDone(fresh({ prepDay: 'sun' }), 3)).toBe(false);
  });

  it('marks stores done once one is switched on', () => {
    const stores = defaultHousehold().stores;
    expect(stepDone(fresh({ stores: stores.map((s) => ({ ...s, enabled: false })) }), 4)).toBe(false);
    expect(stepDone(fresh({ stores: stores.map((s, i) => ({ ...s, enabled: i === 0 })) }), 4)).toBe(true);
  });

  it('marks the budget done only when it differs from the default', () => {
    expect(stepDone(fresh({ defaultBudget: defaultHousehold().defaultBudget }), 5)).toBe(false);
    expect(stepDone(fresh({ defaultBudget: 200 }), 5)).toBe(true);
  });

  it('marks food done by a dish or item rule, or a cuisine that is not at its default', () => {
    expect(stepDone(fresh({ avoidDishes: ['slaw'] }), 6)).toBe(true);
    expect(stepDone(fresh({ itemRules: [{ id: 'r1', name: 'Milk', rule: 'always' }] }), 6)).toBe(true);
    const cuisines = defaultCuisines();
    const first = Object.keys(cuisines)[0]!;
    const changed = cuisines[first] === 'never' ? 'often' : 'never';
    expect(stepDone(fresh({ cuisines: { ...cuisines, [first]: changed } }), 6)).toBe(true);
    expect(stepDone(fresh({ cuisines }), 6)).toBe(false);
  });

  it('marks safety and kitchen done by an allergy, owned equipment, storage or spice rack changes', () => {
    expect(stepDone(fresh({ people: [{ ...person, allergies: ['peanuts'] }] }), 7)).toBe(true);
    const equipment = defaultHousehold().equipment;
    expect(stepDone(fresh({ equipment: equipment.map((e, i) => ({ ...e, owned: i === 0 })) }), 7)).toBe(true);
    expect(stepDone(fresh({ storage: { ...defaultHousehold().storage, freezer: false } }), 7)).toBe(true);
    expect(stepDone(fresh({ onHand: [] }), 7)).toBe(true);
    expect(stepDone(fresh(), 7)).toBe(false);
  });

  it('never marks the welcome or the summary done from data', () => {
    const h = fresh({ people: [person], defaultBudget: 200 });
    expect(stepDone(h, 1)).toBe(false);
    expect(stepDone(h, 8)).toBe(false);
  });
});

describe('canAdvance', () => {
  it('lets the people step go on only once someone exists', () => {
    expect(canAdvance(fresh(), 2)).toBe(false);
    expect(canAdvance(fresh({ people: [person] }), 2)).toBe(true);
    expect(canAdvance(fresh(), 3)).toBe(true);
  });
});

describe('clampStep', () => {
  it('reads a saved step from 1 to 8, and falls back to 1 for anything else', () => {
    expect(clampStep('4')).toBe(4);
    expect(clampStep('8')).toBe(8);
    expect(clampStep(null)).toBe(1);
    expect(clampStep('0')).toBe(1);
    expect(clampStep('9')).toBe(1);
    expect(clampStep('2.5')).toBe(1);
    expect(clampStep('two')).toBe(1);
    expect(clampStep(undefined)).toBe(1);
  });
});
