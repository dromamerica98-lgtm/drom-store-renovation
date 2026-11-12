import type { IsoDate } from '@coach/engine';
import type {
  ActivityDetailsRecord,
  ActivityLap,
  ActivityRecord,
  IntradaySeriesRecord,
} from '../../domain/records';
import type { DateRange, GarminProvider } from '../provider';
import { clamp, rng, round } from './random';
import { MOCK_ATHLETE, simulate, type MockScenario, type SimulatedDay } from './simulate';

export interface MockProviderOptions {
  /** The user's current local date; nothing after it exists. */
  today: IsoDate;
  scenario?: MockScenario;
  seed?: string;
}

/**
 * Synthetic Garmin data with realistic physiology (see simulate.ts).
 * Same (today, scenario, seed) ⇒ identical data, so syncs are reproducible.
 */
export class MockGarminProvider implements GarminProvider {
  readonly mode = 'mock' as const;
  readonly source = 'mock' as const;
  private readonly days: Map<IsoDate, SimulatedDay>;
  private readonly seed: string;

  constructor(options: MockProviderOptions) {
    this.seed = options.seed ?? 'coach-mock-v1';
    this.days = simulate(options.today, options.scenario ?? 'normal', this.seed);
  }

  private inRange(range: DateRange): SimulatedDay[] {
    return [...this.days.values()].filter((d) => d.date >= range.from && d.date <= range.to);
  }

  async dailySummaries(range: DateRange) {
    return this.inRange(range).map((d) => d.summary);
  }

  async sleep(range: DateRange) {
    return this.inRange(range).map((d) => d.sleep);
  }

  async hrv(range: DateRange) {
    return this.inRange(range).map((d) => d.hrv);
  }

  async bodyBattery(range: DateRange) {
    return this.inRange(range).map((d) => d.bodyBattery);
  }

  async stress(range: DateRange) {
    return this.inRange(range).map((d) => d.stress);
  }

  async activities(range: DateRange) {
    return this.inRange(range).flatMap((d) => d.activities);
  }

  private findActivity(id: number): ActivityRecord | undefined {
    const date = String(Math.floor(id / 100)).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    return this.days.get(date)?.activities.find((a) => a.id === id);
  }

  async activityDetails(activityId: number): Promise<ActivityDetailsRecord | null> {
    const a = this.findActivity(activityId);
    if (!a) return null;
    const r = rng(`${this.seed}|details|${a.id}`);
    const step = 10;
    const samples = Math.floor(a.durationSec / step);
    const t: number[] = [];
    const hr: number[] = [];
    const speed: Array<number | null> = [];
    for (let i = 0; i <= samples; i++) {
      const progress = i / Math.max(samples, 1);
      const warm = Math.min(1, progress / 0.15);
      t.push(i * step);
      hr.push(Math.round(clamp((a.avgHr ?? 130) * (0.82 + 0.18 * warm) + r.normal(0, 3), 60, MOCK_ATHLETE.maxHr)));
      speed.push(a.avgSpeedMps ? round(a.avgSpeedMps * (0.9 + 0.1 * warm) * clamp(r.normal(1, 0.04), 0.8, 1.2), 2) : null);
    }
    const laps: ActivityLap[] = [];
    if (a.distanceM && a.avgSpeedMps) {
      const lapSec = 1000 / a.avgSpeedMps;
      for (let i = 0, start = 0; start < a.durationSec; i++, start += lapSec) {
        const dur = Math.min(lapSec, a.durationSec - start);
        laps.push({
          index: i,
          startOffsetSec: Math.round(start),
          durationSec: Math.round(dur),
          distanceM: Math.round(dur * a.avgSpeedMps),
          avgHr: Math.round((a.avgHr ?? 130) + r.normal(0, 3)),
          maxHr: Math.round((a.avgHr ?? 130) + 8 + r.next() * 6),
          avgSpeedMps: round(a.avgSpeedMps * clamp(r.normal(1, 0.03), 0.9, 1.1), 2),
        });
      }
    }
    return {
      activityId: a.id,
      laps,
      streams: { t, hr, ...(a.avgSpeedMps ? { speedMps: speed } : {}) },
      fitObjectKey: null,
      fitSizeBytes: null,
    };
  }

  async intraday(date: IsoDate): Promise<IntradaySeriesRecord[]> {
    const day = this.days.get(date);
    if (!day) return [];
    const r = rng(`${this.seed}|intraday|${date}`);
    const startAt = `${date}T00:00:00Z`;
    const wakeMinute = 6 * 60 + 15;
    const rhr = day.summary.restingHr ?? MOCK_ATHLETE.restingHr;

    const activityAt = (minute: number) =>
      day.activities.find((a) => {
        const start = Number(a.startLocal.slice(11, 13)) * 60 + Number(a.startLocal.slice(14, 16));
        return minute >= start && minute < start + a.durationSec / 60;
      });

    const heartRate: Array<number | null> = [];
    for (let m = 0; m < 1440; m += 2) {
      const act = activityAt(m);
      if (act) heartRate.push(Math.round((act.avgHr ?? 140) + r.normal(0, 4)));
      else if (m < wakeMinute || m >= 23 * 60) heartRate.push(Math.round(rhr + 3 + r.normal(0, 2)));
      else heartRate.push(r.chance(0.02) ? null : Math.round(rhr + 22 + r.normal(0, 7)));
    }

    const stress: Array<number | null> = [];
    const avgStress = day.stress.avgStress ?? 25;
    for (let m = 0; m < 1440; m += 3) {
      if (activityAt(m)) stress.push(null); // Garmin does not score stress during activity
      else if (m < wakeMinute) stress.push(Math.round(clamp(r.normal(14, 4), 0, 100)));
      else stress.push(Math.round(clamp(r.normal(avgStress + 8, 12), 0, 100)));
    }

    const bodyBattery: Array<number | null> = [];
    const wake = day.bodyBattery.atWake ?? 70;
    const low = day.bodyBattery.lowest ?? 20;
    const startLevel = clamp(wake - (day.bodyBattery.charged ?? 40), 5, 100);
    for (let m = 0; m < 1440; m += 3) {
      const level =
        m < wakeMinute
          ? startLevel + ((wake - startLevel) * m) / wakeMinute
          : wake - ((wake - low) * (m - wakeMinute)) / (1440 - wakeMinute);
      bodyBattery.push(Math.round(clamp(level, 0, 100)));
    }

    return [
      { date, metric: 'heart_rate', startAt, intervalSec: 120, samples: heartRate },
      { date, metric: 'stress', startAt, intervalSec: 180, samples: stress },
      { date, metric: 'body_battery', startAt, intervalSec: 180, samples: bodyBattery },
    ];
  }
}
