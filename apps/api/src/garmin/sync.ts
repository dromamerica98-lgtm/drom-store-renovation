/**
 * SyncService — pulls data from a GarminProvider into D1.
 *
 * Each run, per domain:
 *   1. Recent window: from (newest synced date − overlap) to today. The
 *      overlap re-fetches days Garmin may still revise (late watch syncs).
 *   2. Backfill: extends history backwards by at most `backfillChunkDays`
 *      until `historyDays` of history exist. Spreading backfill over runs
 *      keeps each run within Workers' subrequest limits in live mode.
 * Writes are idempotent upserts. A failure in one domain is recorded and
 * does not stop the others.
 */
import { addDays, maxDate, minDate, type IsoDate } from '@coach/engine';
import type { Repositories } from '../db';
import type { SyncState, SyncTrigger } from '../db/sync';
import type { SyncDomain, WriteMeta } from '../domain/records';
import type { DateRange, GarminProvider } from './provider';

export interface SyncOptions {
  trigger: SyncTrigger;
  /** User's local date. */
  today: IsoDate;
  /** Days re-fetched before the newest synced date. Default 3. */
  overlapDays?: number;
  /** Size of the very first recent window. Default 14. */
  initialDays?: number;
  /** History to build up through backfill. Default 180. */
  historyDays?: number;
  /** Max older days fetched per domain per run. Default 28. */
  backfillChunkDays?: number;
  /** Max activity-detail fetches per run. Default 10. */
  maxDetailFetches?: number;
  /** How far back to look for activities missing details. Default 14. */
  detailLookbackDays?: number;
  /** Days of intraday curves to refresh (ending today). Default 2. */
  intradayDays?: number;
}

export interface SyncResult {
  runId: number;
  status: 'success' | 'partial' | 'error';
  counts: Record<string, number>;
  errors: Array<{ domain: SyncDomain; message: string }>;
}

type DailyDomain = Exclude<SyncDomain, 'activity_details' | 'intraday'>;

const DAILY_DOMAINS: Array<{
  domain: DailyDomain;
  fetchAndStore: (p: GarminProvider, repos: Repositories, range: DateRange, meta: WriteMeta) => Promise<number>;
}> = [
  { domain: 'daily_summary', fetchAndStore: async (p, r, range, m) => r.health.upsertDailySummaries(await p.dailySummaries(range), m) },
  { domain: 'sleep', fetchAndStore: async (p, r, range, m) => r.health.upsertSleep(await p.sleep(range), m) },
  { domain: 'hrv', fetchAndStore: async (p, r, range, m) => r.health.upsertHrv(await p.hrv(range), m) },
  { domain: 'body_battery', fetchAndStore: async (p, r, range, m) => r.health.upsertBodyBattery(await p.bodyBattery(range), m) },
  { domain: 'stress', fetchAndStore: async (p, r, range, m) => r.health.upsertStress(await p.stress(range), m) },
  { domain: 'activities', fetchAndStore: async (p, r, range, m) => r.activities.upsertMany(await p.activities(range), m) },
];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Splits [from, to] into windows of at most `size` days, newest first. */
export function chunkRange(range: DateRange, size: number): DateRange[] {
  const out: DateRange[] = [];
  for (let to = range.to; to >= range.from; to = addDays(to, -size)) {
    out.push({ from: maxDate(range.from, addDays(to, -(size - 1))), to });
  }
  return out;
}

/** The windows one domain should fetch in this run. Exported for tests. */
export function planWindows(state: SyncState | undefined, opts: Required<Omit<SyncOptions, 'trigger'>>): DateRange[] {
  const { today } = opts;
  const historyStart = addDays(today, -(opts.historyDays - 1));
  const recentFrom = state?.newestSyncedDate
    ? maxDate(historyStart, minDate(today, addDays(state.newestSyncedDate, -opts.overlapDays)))
    : maxDate(historyStart, addDays(today, -(opts.initialDays - 1)));
  const windows = chunkRange({ from: recentFrom, to: today }, opts.backfillChunkDays);

  const oldest = state?.oldestSyncedDate ? minDate(state.oldestSyncedDate, recentFrom) : recentFrom;
  if (oldest > historyStart) {
    windows.push({ from: maxDate(historyStart, addDays(oldest, -opts.backfillChunkDays)), to: addDays(oldest, -1) });
  }
  return windows;
}

export class SyncService {
  constructor(
    private readonly repos: Repositories,
    private readonly provider: GarminProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private timestamp(): string {
    return this.now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  async run(options: SyncOptions): Promise<SyncResult> {
    const opts = {
      overlapDays: 3,
      initialDays: 14,
      historyDays: 180,
      backfillChunkDays: 28,
      maxDetailFetches: 10,
      detailLookbackDays: 14,
      intradayDays: 2,
      ...options,
    };
    const meta: WriteMeta = { source: this.provider.source, fetchedAt: this.timestamp() };
    const runId = await this.repos.sync.startRun(
      opts.trigger,
      this.provider.mode,
      { from: addDays(opts.today, -(opts.historyDays - 1)), to: opts.today },
      meta.fetchedAt,
    );
    const states = await this.repos.sync.getStates();
    const counts: Record<string, number> = {};
    const errors: SyncResult['errors'] = [];
    let anySuccess = false;

    for (const { domain, fetchAndStore } of DAILY_DOMAINS) {
      try {
        counts[domain] = 0;
        for (const window of planWindows(states.get(domain), opts)) {
          counts[domain] += await fetchAndStore(this.provider, this.repos, window, meta);
          await this.repos.sync.markSuccess(domain, window.from, window.to, meta.fetchedAt);
        }
        anySuccess = true;
      } catch (e) {
        errors.push({ domain, message: message(e) });
        await this.repos.sync.markError(domain, message(e), meta.fetchedAt);
      }
    }

    // Activity details: bounded number per run, most recent activities first.
    try {
      const from = addDays(opts.today, -(opts.detailLookbackDays - 1));
      const ids = (await this.repos.activities.idsMissingDetails(from, opts.today)).reverse().slice(0, opts.maxDetailFetches);
      counts.activity_details = 0;
      for (const id of ids) {
        const details = await this.provider.activityDetails(id);
        if (!details) continue;
        await this.repos.activities.upsertDetails(details, meta);
        counts.activity_details++;
      }
      await this.repos.sync.markSuccess('activity_details', from, opts.today, meta.fetchedAt);
      anySuccess = true;
    } catch (e) {
      errors.push({ domain: 'activity_details', message: message(e) });
      await this.repos.sync.markError('activity_details', message(e), meta.fetchedAt);
    }

    // Intraday curves for the last few days.
    try {
      const from = addDays(opts.today, -(opts.intradayDays - 1));
      counts.intraday = 0;
      for (let d = from; d <= opts.today; d = addDays(d, 1)) {
        counts.intraday += await this.repos.health.upsertIntraday(await this.provider.intraday(d), meta);
      }
      await this.repos.sync.markSuccess('intraday', from, opts.today, meta.fetchedAt);
      anySuccess = true;
    } catch (e) {
      errors.push({ domain: 'intraday', message: message(e) });
      await this.repos.sync.markError('intraday', message(e), meta.fetchedAt);
    }

    const status = errors.length === 0 ? 'success' : anySuccess ? 'partial' : 'error';
    await this.repos.sync.finishRun(
      runId,
      status,
      counts,
      errors.length ? errors.map((e) => `${e.domain}: ${e.message}`).join('; ') : null,
      this.timestamp(),
    );
    return { runId, status, counts, errors };
  }
}
