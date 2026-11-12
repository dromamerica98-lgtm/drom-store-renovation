/**
 * Calendar-date arithmetic on `YYYY-MM-DD` strings. Dates are treated as
 * plain calendar days (UTC math on midnight), so DST never shifts a day.
 */
import type { IsoDate, Weekday } from './domain';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtcMs(date: IsoDate): number {
  if (!isIsoDate(date)) throw new RangeError(`Invalid ISO date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekday(date: IsoDate): Weekday {
  const js = new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) as Weekday;
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

/** Local calendar date of an instant in an IANA timezone (e.g. "Europe/Helsinki"). */
export function localDate(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
