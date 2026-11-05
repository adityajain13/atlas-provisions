import { describe, expect, it } from 'vitest';
import type { Checks } from '@provisions/shared';
import {
  NO_PENDING,
  addPending,
  legacyUpload,
  mergeChecks,
  parseLegacyTicks,
  setServerTick,
  settlePending,
} from './checks';

const server: Checks = { list: { milk: true, eggs: false }, prep: { 'prep-1': true }, updatedAt: '2026-11-01T12:00:00.000Z' };

describe('mergeChecks', () => {
  it('shows the server ticks when nothing is pending', () => {
    expect(mergeChecks(server, NO_PENDING)).toEqual(server);
  });

  it('lays a pending tick over the server so a poll does not undo it', () => {
    const pending = addPending(NO_PENDING, 'list', 'eggs', true, 1);
    const merged = mergeChecks(server, pending);
    expect(merged.list).toEqual({ milk: true, eggs: true });
    expect(merged.updatedAt).toBe(server.updatedAt);
  });

  it('keeps list and prep ticks apart', () => {
    const pending = addPending(NO_PENDING, 'prep', 'milk', true, 1);
    expect(mergeChecks(server, pending).list).toEqual(server.list);
    expect(mergeChecks(server, pending).prep).toEqual({ 'prep-1': true, milk: true });
  });
});

describe('settlePending', () => {
  it('drops a tick once its own write is confirmed', () => {
    const pending = addPending(NO_PENDING, 'list', 'milk', false, 3);
    expect(settlePending(pending, 'list', 'milk', 3)).toEqual(NO_PENDING);
  });

  it('keeps a tick whose newer write is still in flight', () => {
    // Two quick toggles: the first write (seq 1) confirms after the second (seq 2) was made.
    const pending = addPending(addPending(NO_PENDING, 'list', 'milk', true, 1), 'list', 'milk', false, 2);
    const after = settlePending(pending, 'list', 'milk', 1);
    expect(after.list.milk).toEqual({ checked: false, seq: 2 });
  });
});

describe('setServerTick', () => {
  it('sets one item and leaves the rest of the snapshot alone', () => {
    const next = setServerTick(server, 'prep', 'prep-2', true);
    expect(next.prep).toEqual({ 'prep-1': true, 'prep-2': true });
    expect(next.list).toBe(server.list);
  });
});

describe('parseLegacyTicks', () => {
  it('reads a stored array of ids, drops repeats, and ignores junk', () => {
    expect(parseLegacyTicks(JSON.stringify(['milk', 'milk', 7, '', 'eggs']))).toEqual(['milk', 'eggs']);
  });

  it('returns nothing for a missing, unreadable or non-array value', () => {
    expect(parseLegacyTicks(null)).toEqual([]);
    expect(parseLegacyTicks('{not json')).toEqual([]);
    expect(parseLegacyTicks('{"milk":true}')).toEqual([]);
  });
});

describe('legacyUpload', () => {
  it('uploads a kind that has local ticks and no server ticks yet', () => {
    const upload = legacyUpload({ list: ['milk'], prep: ['prep-1'] }, { list: {}, prep: {}, updatedAt: null });
    expect(upload).toEqual({ list: { milk: true }, prep: { 'prep-1': true } });
  });

  it('skips a kind the server already has ticks for', () => {
    const upload = legacyUpload({ list: ['milk'], prep: ['prep-1'] }, server);
    expect(upload).toBeNull();
  });

  it('returns null when this browser has nothing to move', () => {
    expect(legacyUpload({ list: [], prep: [] }, { list: {}, prep: {}, updatedAt: null })).toBeNull();
  });
});
