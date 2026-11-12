import { describe, expect, it } from 'vitest';
import { duration, durationCompact, km, pace, percentDelta, relativeTime, signed } from '../src/format';

describe('format', () => {
  it('formats durations', () => {
    expect(duration(2700)).toBe('45 min');
    expect(duration(4500)).toBe('1 h 15 min');
    expect(duration(7200)).toBe('2 h');
    expect(durationCompact(14340)).toBe('3:59 h');
  });

  it('formats distance and pace', () => {
    expect(km(8420)).toBe('8.4 km');
    expect(pace(302)).toBe('5:02');
  });

  it('uses a true minus sign and ±0', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(-17)).toBe('−17');
    expect(signed(0.2)).toBe('±0');
    expect(percentDelta(58, 60)).toBe('−3%');
  });

  it('formats relative time', () => {
    const now = Date.parse('2026-11-12T09:00:00Z');
    expect(relativeTime('2026-11-12T08:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-11-12T08:15:00Z', now)).toBe('45 min ago');
    expect(relativeTime('2026-11-12T05:00:00Z', now)).toBe('4 h ago');
  });
});
