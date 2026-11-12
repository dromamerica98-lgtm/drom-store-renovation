/** Display formatting. Values arrive in SI units from the API. */

const MINUS = '−';

/** 2700 → "45 min"; 4500 → "1 h 15 min". */
export function duration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 2700 → "45′"; 4500 → "1:15 h" — compact, for tight spaces. */
export function durationCompact(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m} min` : `${h}:${String(m).padStart(2, '0')} h`;
}

export function km(metres: number, digits = 1): string {
  return `${(metres / 1000).toFixed(digits)} km`;
}

/** 312 → "5:12 /km". */
export function pace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function signed(n: number, digits = 0): string {
  const v = Number(n.toFixed(digits));
  if (v === 0) return '±0';
  return v > 0 ? `+${v.toFixed(digits)}` : `${MINUS}${Math.abs(v).toFixed(digits)}`;
}

export function percentDelta(value: number, base: number): string {
  return `${signed(((value - base) / base) * 100)}%`;
}

/** "2026-11-12" → "Thursday, 12 November". */
export function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export function shortTime(isoTs: string): string {
  return new Date(isoTs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(isoTs: string, now = Date.now()): string {
  const diff = Math.round((now - Date.parse(isoTs)) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  const h = Math.round(diff / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
