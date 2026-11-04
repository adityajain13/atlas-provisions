import { describe, expect, it } from 'vitest';
import { DAYS } from '@provisions/shared';
import { formatDays } from './labels';

describe('formatDays', () => {
  it('handles empty and full weeks', () => {
    expect(formatDays([])).toBe('No days');
    expect(formatDays([...DAYS])).toBe('Every day');
  });

  it('collapses a weekday run without moving it', () => {
    expect(formatDays(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('Mon–Fri');
  });

  it('lists Sat and Sun separately, Sunday first', () => {
    expect(formatDays(['sat', 'sun'])).toBe('Sun, Sat');
  });

  it('splits a run that wraps past Saturday into Sunday-first ranges', () => {
    expect(formatDays(['fri', 'sat', 'sun', 'mon'])).toBe('Sun–Mon, Fri–Sat');
  });

  it('prints a lone day and non-adjacent days as they fall in Sunday-first order', () => {
    expect(formatDays(['wed'])).toBe('Wed');
    expect(formatDays(['fri', 'mon', 'wed'])).toBe('Mon, Wed, Fri');
  });

  it('orders the days Sunday first and keeps every day exactly once', () => {
    expect(DAYS[0]).toBe('sun');
    expect(DAYS[DAYS.length - 1]).toBe('sat');
    expect([...DAYS].sort()).toEqual(['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed']);
  });
});
