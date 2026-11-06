import { describe, expect, it } from 'vitest';
import {
  applyKey,
  attendanceMenu,
  changeMessage,
  parseMore,
  setChoices,
  setHeadcounts,
  type AttendanceCell,
  type AttendanceState,
} from './attendance';

const cell = (day: 'sun' | 'mon', slot: 'breakfast' | 'dinner', over: Partial<AttendanceCell> = {}): AttendanceCell => ({
  cell: { day, slot },
  fixed: false,
  value: 2,
  def: 2,
  choice: 'keep',
  ...over,
});

const EMPTY: AttendanceState = { overrides: {}, choices: {} };

describe('setHeadcounts', () => {
  it('sets an override, and removes it when the value is back at the default', () => {
    const a = cell('sun', 'breakfast', { value: 2, def: 2 });
    const b = cell('mon', 'dinner', { value: 3, def: 2 });
    expect(setHeadcounts({}, [a], 0)).toEqual({ 'sun-breakfast': 0 });
    expect(setHeadcounts({ 'sun-breakfast': 0 }, [a], 2)).toEqual({});
    expect(setHeadcounts({ 'mon-dinner': 3 }, [b], 2)).toEqual({});
  });

  it('leaves fixed cells alone', () => {
    const f = cell('sun', 'breakfast', { fixed: true, def: 2 });
    expect(setHeadcounts({}, [f], 0)).toEqual({});
  });
});

describe('applyKey', () => {
  it('a number applies to the non-fixed cells only, and the fixed cells keep their choice', () => {
    const plain = cell('sun', 'dinner', { value: 2, def: 2 });
    const fixed = cell('mon', 'dinner', { fixed: true, choice: 'plan' });
    const next = applyKey(EMPTY, [plain, fixed], '3');
    expect(next.overrides).toEqual({ 'sun-dinner': 3 });
    expect(next.choices).toEqual({});
  });

  it('out applies to both kinds of cell', () => {
    const plain = cell('sun', 'dinner');
    const fixed = cell('mon', 'dinner', { fixed: true, choice: 'keep' });
    const next = applyKey(EMPTY, [plain, fixed], 'out');
    expect(next.overrides).toEqual({ 'sun-dinner': 0 });
    expect(next.choices).toEqual({ 'mon-dinner': 'out' });
  });

  it('keep and plan change only fixed cells, and keep removes the entry', () => {
    const fixed = cell('mon', 'dinner', { fixed: true, choice: 'out' });
    expect(applyKey(EMPTY, [fixed], 'plan').choices).toEqual({ 'mon-dinner': 'plan' });
    expect(applyKey({ overrides: {}, choices: { 'mon-dinner': 'out' } }, [fixed], 'keep').choices).toEqual({});
  });
});

describe('attendanceMenu', () => {
  it('offers out, 1, 2, 3 and More…, and marks the default', () => {
    const menu = attendanceMenu([cell('sun', 'dinner', { value: 2, def: 2 })]);
    expect(menu.items.map((i) => i.key)).toEqual(['out', '1', '2', '3']);
    expect(menu.items.find((i) => i.key === '2')).toMatchObject({ checked: true, note: '(default)' });
    expect(menu.items.find((i) => i.key === 'out')).toMatchObject({ checked: false });
    expect(menu.custom).toBe(true);
  });

  it('marks out as the default when nobody eats the cell by default', () => {
    const menu = attendanceMenu([cell('sun', 'dinner', { value: 0, def: 0 })]);
    expect(menu.items.find((i) => i.key === 'out')).toMatchObject({ checked: true, note: '(default)' });
  });

  it('lists a default or current count above 3, so it can be seen and picked', () => {
    const menu = attendanceMenu([cell('sun', 'dinner', { value: 5, def: 5 })]);
    expect(menu.items.map((i) => i.key)).toEqual(['out', '1', '2', '3', '5']);
    expect(menu.items.find((i) => i.key === '5')).toMatchObject({ checked: true, note: '(default)' });
  });

  it('a mixed selection with fixed meals offers the fixed choices first and the numbers after', () => {
    const menu = attendanceMenu([cell('sun', 'dinner'), cell('mon', 'dinner', { fixed: true, choice: 'keep' })]);
    expect(menu.items.map((i) => i.key)).toEqual(['keep', 'plan', 'out', '1', '2', '3']);
    expect(menu.items.find((i) => i.key === 'keep')).toMatchObject({ checked: true, note: '(default)' });
  });

  it('a selection of fixed meals only offers the fixed choices, and no counts', () => {
    const menu = attendanceMenu([cell('mon', 'dinner', { fixed: true, choice: 'plan' })]);
    expect(menu.items.map((i) => i.key)).toEqual(['keep', 'plan', 'out']);
    expect(menu.custom).toBeUndefined();
  });

  it('a mixed count shows no checked number', () => {
    const menu = attendanceMenu([cell('sun', 'dinner', { value: 1 }), cell('mon', 'dinner', { value: 2 })]);
    expect(menu.items.some((i) => i.checked)).toBe(false);
    expect(menu.subtitle).toContain('mixed counts');
  });
});

describe('parseMore and messages', () => {
  it('takes whole numbers from 4 to 10 only', () => {
    expect(parseMore('4')).toEqual({ ok: true, value: 4 });
    expect(parseMore(' 10 ')).toEqual({ ok: true, value: 10 });
    expect(parseMore('3')).toMatchObject({ ok: false });
    expect(parseMore('11')).toMatchObject({ ok: false });
    expect(parseMore('2.5')).toMatchObject({ ok: false });
    expect(parseMore('')).toMatchObject({ ok: false });
  });

  it('describes a bulk change', () => {
    const plain = cell('sun', 'dinner');
    const fixed = cell('mon', 'dinner', { fixed: true });
    expect(changeMessage('2', [plain, fixed])).toBe('1 meal set to 2 people');
    expect(changeMessage('out', [plain, fixed])).toBe('2 meals set to out');
    expect(changeMessage('keep', [fixed])).toBe('Kept 1 fixed meal');
  });
});

describe('setChoices', () => {
  it('keeps the map of other cells', () => {
    const fixed = cell('mon', 'dinner', { fixed: true });
    expect(setChoices({ 'tue-dinner': 'out' }, [fixed], 'plan')).toEqual({ 'tue-dinner': 'out', 'mon-dinner': 'plan' });
  });
});
