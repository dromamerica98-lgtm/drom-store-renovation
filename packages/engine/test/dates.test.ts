import { describe, expect, it } from 'vitest';
import { addDays, dateRange, daysBetween, isIsoDate, localDate, weekday } from '../src/dates';

describe('dates', () => {
  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('is not affected by DST transitions', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('computes ISO weekdays', () => {
    expect(weekday('2026-11-09')).toBe(1); // Monday
    expect(weekday('2026-11-15')).toBe(7); // Sunday
  });

  it('builds inclusive ranges', () => {
    expect(dateRange('2026-11-10', '2026-11-12')).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(dateRange('2026-11-12', '2026-11-11')).toEqual([]);
  });

  it('validates dates strictly', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-1-01')).toBe(false);
    expect(() => addDays('nope', 1)).toThrow(RangeError);
  });

  it('resolves the local date in a timezone', () => {
    const instant = new Date('2026-11-12T23:30:00Z');
    expect(localDate(instant, 'UTC')).toBe('2026-11-12');
    expect(localDate(instant, 'Europe/Helsinki')).toBe('2026-11-13');
    expect(localDate(instant, 'America/Los_Angeles')).toBe('2026-11-12');
  });
});
