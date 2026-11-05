import { describe, expect, it } from 'vitest';
import { defaultHousehold, type Household } from '@provisions/shared';
import {
  allCells,
  applyCaps,
  bulkMessage,
  capCount,
  capOptions,
  capAt,
  type Cell,
  commonCap,
  dayCells,
  formatTimeCap,
  moveCell,
  parseCustomCap,
  rectCells,
  slotCells,
  snapshotCaps,
  spokenCap,
  weekendCells,
  weeknightDinnerCells,
  hasMoreBelow,
} from './timeCaps';

const withCaps = (timeCaps: Household['timeCaps']): Household => ({ ...defaultHousehold(), timeCaps });

describe('formatTimeCap', () => {
  it('labels minutes under an hour in full and compact forms', () => {
    expect(formatTimeCap(5)).toBe('5 min');
    expect(formatTimeCap(15)).toBe('15 min');
    expect(formatTimeCap(15, 'compact')).toBe('15m');
    expect(formatTimeCap(45, 'compact')).toBe('45m');
  });

  it('labels whole hours, the one and a half hour, and hours with minutes', () => {
    expect(formatTimeCap(60)).toBe('1 h');
    expect(formatTimeCap(90)).toBe('1½ h');
    expect(formatTimeCap(120)).toBe('2 h');
    expect(formatTimeCap(75)).toBe('1 h 15');
    expect(formatTimeCap(60, 'compact')).toBe('1h');
    expect(formatTimeCap(90, 'compact')).toBe('1½h');
    expect(formatTimeCap(75, 'compact')).toBe('1h15');
  });

  it('gives a screen reader the minutes and the words for no cap', () => {
    expect(spokenCap(30)).toBe('30 minute cap');
    expect(spokenCap(undefined)).toBe('no cap');
  });
});

describe('capOptions', () => {
  it('starts with no cap and lists the presets in order', () => {
    expect(capOptions(undefined)).toEqual([undefined, 5, 10, 15, 20, 30, 45, 60, 90, 120]);
  });

  it('adds a custom value already set, in its place', () => {
    expect(capOptions(75)).toEqual([undefined, 5, 10, 15, 20, 30, 45, 60, 75, 90, 120]);
  });
});

describe('parseCustomCap', () => {
  it('accepts whole multiples of 5 from 5 to 180', () => {
    expect(parseCustomCap('5')).toEqual({ ok: true, minutes: 5 });
    expect(parseCustomCap(' 180 ')).toEqual({ ok: true, minutes: 180 });
    expect(parseCustomCap('75')).toEqual({ ok: true, minutes: 75 });
  });

  it('refuses empty, out of range, fractional and non-multiple-of-5 input', () => {
    expect(parseCustomCap('').ok).toBe(false);
    expect(parseCustomCap('0').ok).toBe(false);
    expect(parseCustomCap('4').ok).toBe(false);
    expect(parseCustomCap('185').ok).toBe(false);
    expect(parseCustomCap('12.5').ok).toBe(false);
    expect(parseCustomCap('12').ok).toBe(false);
    const bad = parseCustomCap('12');
    expect(bad.ok === false && bad.error).toBe('Use a multiple of 5.');
  });
});

describe('cell sets', () => {
  it('covers the grid, a slot, a day, the weeknight dinners and the weekend', () => {
    expect(allCells()).toHaveLength(21);
    expect(slotCells('dinner').map((c) => c.day)).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    expect(dayCells('tue').map((c) => c.slot)).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(weeknightDinnerCells().map((c) => `${c.day}-${c.slot}`)).toEqual([
      'mon-dinner',
      'tue-dinner',
      'wed-dinner',
      'thu-dinner',
    ]);
    expect(weekendCells()).toHaveLength(6);
  });

  it('selects the rectangle between two corners, in either order', () => {
    const keys = rectCells({ day: 'wed', slot: 'dinner' }, { day: 'mon', slot: 'breakfast' })
      .map((c) => `${c.day}-${c.slot}`)
      .sort();
    expect(keys).toEqual([
      'mon-breakfast',
      'mon-dinner',
      'mon-lunch',
      'tue-breakfast',
      'tue-dinner',
      'tue-lunch',
      'wed-breakfast',
      'wed-dinner',
      'wed-lunch',
    ]);
    expect(rectCells({ day: 'sun', slot: 'lunch' }, { day: 'sun', slot: 'lunch' })).toEqual([
      { day: 'sun', slot: 'lunch' },
    ]);
  });

  it('moves focus by key and stops at the grid edges', () => {
    expect(moveCell({ day: 'sun', slot: 'breakfast' }, 'left')).toEqual({ day: 'sun', slot: 'breakfast' });
    expect(moveCell({ day: 'sun', slot: 'breakfast' }, 'right')).toEqual({ day: 'mon', slot: 'breakfast' });
    expect(moveCell({ day: 'sat', slot: 'dinner' }, 'down')).toEqual({ day: 'sat', slot: 'dinner' });
    expect(moveCell({ day: 'wed', slot: 'lunch' }, 'up')).toEqual({ day: 'wed', slot: 'breakfast' });
    expect(moveCell({ day: 'wed', slot: 'lunch' }, 'home')).toEqual({ day: 'sun', slot: 'lunch' });
    expect(moveCell({ day: 'wed', slot: 'lunch' }, 'end')).toEqual({ day: 'sat', slot: 'lunch' });
  });
});

describe('commonCap', () => {
  const caps = withCaps({ mon: { dinner: 30 }, tue: { dinner: 30, lunch: 15 } }).timeCaps;

  it('reports the shared value, or mixed when the cells differ', () => {
    expect(commonCap(caps, [{ day: 'mon', slot: 'dinner' }, { day: 'tue', slot: 'dinner' }])).toEqual({
      mixed: false,
      minutes: 30,
    });
    expect(commonCap(caps, [{ day: 'mon', slot: 'dinner' }, { day: 'tue', slot: 'lunch' }])).toEqual({ mixed: true });
    expect(commonCap(caps, [{ day: 'sun', slot: 'dinner' }])).toEqual({ mixed: false, minutes: undefined });
  });
});

describe('applyCaps and snapshotCaps', () => {
  it('sets and clears cells without touching the input', () => {
    const before = withCaps({ mon: { dinner: 30 } });
    const after = applyCaps(before, [
      { day: 'mon', slot: 'dinner', minutes: undefined },
      { day: 'tue', slot: 'lunch', minutes: 120 },
    ]);
    expect(after.timeCaps).toEqual({ tue: { lunch: 120 } });
    expect(before.timeCaps).toEqual({ mon: { dinner: 30 } });
  });

  it('drops a day that has no caps left, and counts the rest', () => {
    const h = withCaps({ mon: { dinner: 30, lunch: 15 } });
    expect(applyCaps(h, [{ day: 'mon', slot: 'dinner', minutes: undefined }]).timeCaps).toEqual({ mon: { lunch: 15 } });
    expect(capCount(h.timeCaps)).toBe(2);
  });

  it('restores exactly what a snapshot recorded', () => {
    const h = withCaps({ mon: { dinner: 30 }, fri: { breakfast: 5 } });
    const cells: Cell[] = [
      { day: 'mon', slot: 'dinner' },
      { day: 'sun', slot: 'lunch' },
    ];
    const snap = snapshotCaps(h, cells);
    const changed = applyCaps(h, cells.map((c) => ({ ...c, minutes: 60 })));
    const restored = applyCaps(changed, snap);
    expect(restored.timeCaps).toEqual(h.timeCaps);
    expect(capAt(restored.timeCaps, { day: 'sun', slot: 'lunch' })).toBeUndefined();
  });
});

describe('bulkMessage', () => {
  it('names the count and the cap, in the singular for one cell', () => {
    expect(bulkMessage(7, 30)).toBe('Set 7 cells to 30 min');
    expect(bulkMessage(1, 120)).toBe('Set 1 cell to 2 h');
    expect(bulkMessage(21, undefined)).toBe('Cleared 21 cells');
  });
});

describe('hasMoreBelow', () => {
  it('is true while rows are hidden below the visible part', () => {
    expect(hasMoreBelow(0, 288, 600)).toBe(true);
    expect(hasMoreBelow(200, 288, 600)).toBe(true);
  });

  it('is false at the bottom, or when the list fits', () => {
    expect(hasMoreBelow(312, 288, 600)).toBe(false);
    expect(hasMoreBelow(0, 288, 200)).toBe(false);
    // A sub-pixel gap at the bottom does not count.
    expect(hasMoreBelow(310, 288, 600)).toBe(false);
  });
});
