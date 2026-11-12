import type { IsoDate, IsoTimestamp } from '@coach/engine';
import type { SyncDomain } from '../domain/records';
import { parseJson } from './sql';

export interface SyncState {
  domain: SyncDomain;
  newestSyncedDate: IsoDate | null;
  oldestSyncedDate: IsoDate | null;
  lastSuccessAt: IsoTimestamp | null;
  lastError: string | null;
  lastErrorAt: IsoTimestamp | null;
}

export type SyncTrigger = 'cron' | 'manual' | 'backfill';
export type SyncRunStatus = 'running' | 'success' | 'partial' | 'error';

export interface SyncRun {
  id: number;
  trigger: SyncTrigger;
  provider: 'mock' | 'live';
  status: SyncRunStatus;
  rangeStart: IsoDate | null;
  rangeEnd: IsoDate | null;
  stats: Record<string, number> | null;
  error: string | null;
  startedAt: IsoTimestamp;
  finishedAt: IsoTimestamp | null;
}

type StateRow = {
  domain: SyncDomain;
  newest_synced_date: string | null;
  oldest_synced_date: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

type RunRow = {
  id: number;
  trigger: SyncTrigger;
  provider: 'mock' | 'live';
  status: SyncRunStatus;
  range_start: string | null;
  range_end: string | null;
  stats_json: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export class SyncRepository {
  constructor(private readonly db: D1Database) {}

  async getStates(): Promise<Map<SyncDomain, SyncState>> {
    const { results } = await this.db.prepare('SELECT * FROM sync_state').all<StateRow>();
    return new Map(
      results.map((r) => [
        r.domain,
        {
          domain: r.domain,
          newestSyncedDate: r.newest_synced_date,
          oldestSyncedDate: r.oldest_synced_date,
          lastSuccessAt: r.last_success_at,
          lastError: r.last_error,
          lastErrorAt: r.last_error_at,
        },
      ]),
    );
  }

  /** Records a successful fetch of [from, to]; widens the synced window, clears the error. */
  async markSuccess(domain: SyncDomain, from: IsoDate, to: IsoDate, now: IsoTimestamp): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sync_state (domain, newest_synced_date, oldest_synced_date, last_success_at, last_error, last_error_at, updated_at)
         VALUES (?1, ?3, ?2, ?4, NULL, NULL, ?4)
         ON CONFLICT (domain) DO UPDATE SET
           newest_synced_date = CASE WHEN newest_synced_date IS NULL OR excluded.newest_synced_date > newest_synced_date
                                     THEN excluded.newest_synced_date ELSE newest_synced_date END,
           oldest_synced_date = CASE WHEN oldest_synced_date IS NULL OR excluded.oldest_synced_date < oldest_synced_date
                                     THEN excluded.oldest_synced_date ELSE oldest_synced_date END,
           last_success_at = excluded.last_success_at,
           last_error = NULL,
           last_error_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(domain, from, to, now)
      .run();
  }

  async markError(domain: SyncDomain, message: string, now: IsoTimestamp): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sync_state (domain, last_error, last_error_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (domain) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at,
           updated_at = excluded.updated_at`,
      )
      .bind(domain, message.slice(0, 1000), now)
      .run();
  }

  async startRun(
    trigger: SyncTrigger,
    provider: 'mock' | 'live',
    range: { from: IsoDate; to: IsoDate },
    now: IsoTimestamp,
  ): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO sync_runs (trigger, provider, status, range_start, range_end, started_at)
         VALUES (?1, ?2, 'running', ?3, ?4, ?5) RETURNING id`,
      )
      .bind(trigger, provider, range.from, range.to, now)
      .first<{ id: number }>();
    if (!row) throw new Error('failed to create sync run');
    return row.id;
  }

  async finishRun(
    id: number,
    status: Exclude<SyncRunStatus, 'running'>,
    stats: Record<string, number>,
    error: string | null,
    now: IsoTimestamp,
  ): Promise<void> {
    await this.db
      .prepare('UPDATE sync_runs SET status = ?2, stats_json = ?3, error = ?4, finished_at = ?5 WHERE id = ?1')
      .bind(id, status, JSON.stringify(stats), error, now)
      .run();
  }

  async recentRuns(limit = 10): Promise<SyncRun[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?1')
      .bind(limit)
      .all<RunRow>();
    return results.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      provider: r.provider,
      status: r.status,
      rangeStart: r.range_start,
      rangeEnd: r.range_end,
      stats: parseJson<Record<string, number>>(r.stats_json),
      error: r.error,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }));
  }
}
