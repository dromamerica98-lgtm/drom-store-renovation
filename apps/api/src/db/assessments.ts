import type { DailyAssessment, IsoDate, IsoTimestamp } from '@coach/engine';
import { type Column, upsertStatement } from './sql';

export interface StoredAssessment {
  date: IsoDate;
  engineVersion: string;
  inputsHash: string;
  readinessScore: number | null;
  readinessBand: string;
  confidence: number;
  dailyLoad: number | null;
  atl: number | null;
  ctl: number | null;
  tsb: number | null;
  acwr: number | null;
  computedAt: IsoTimestamp;
}

type Row = {
  date: string;
  engine_version: string;
  inputs_hash: string;
  readiness_score: number | null;
  readiness_band: string;
  confidence: number;
  daily_load: number | null;
  atl: number | null;
  ctl: number | null;
  tsb: number | null;
  acwr: number | null;
  computed_at: string;
};

type Input = { a: DailyAssessment; computedAt: IsoTimestamp };

const COLUMNS: Column<Input>[] = [
  ['date', ({ a }) => a.date],
  ['engine_version', ({ a }) => a.engineVersion],
  ['inputs_hash', ({ a }) => a.inputsHash],
  ['readiness_score', ({ a }) => a.readiness.score],
  ['readiness_band', ({ a }) => a.readiness.band],
  ['confidence', ({ a }) => a.readiness.confidence],
  ['daily_load', ({ a }) => a.load.yesterday.load],
  ['atl', ({ a }) => a.load.atl],
  ['ctl', ({ a }) => a.load.ctl],
  ['tsb', ({ a }) => a.load.tsb],
  ['acwr', ({ a }) => a.load.acwr],
  ['components_json', ({ a }) => JSON.stringify(a.readiness.components)],
  ['baselines_json', ({ a }) => JSON.stringify(a.baselines)],
  ['load_json', ({ a }) => JSON.stringify(a.load)],
  ['flags_json', ({ a }) => JSON.stringify(a.flags)],
  ['computed_at', ({ computedAt }) => computedAt],
];

/** Engine output per day — the audit trail behind every recommendation. */
export class AssessmentRepository {
  constructor(private readonly db: D1Database) {}

  async upsert(a: DailyAssessment, computedAt: IsoTimestamp): Promise<void> {
    await upsertStatement(this.db, 'daily_assessments', ['date'], COLUMNS, { a, computedAt }).run();
  }

  async get(date: IsoDate): Promise<StoredAssessment | null> {
    const r = await this.db
      .prepare(
        `SELECT date, engine_version, inputs_hash, readiness_score, readiness_band, confidence, daily_load, atl, ctl, tsb, acwr, computed_at
         FROM daily_assessments WHERE date = ?1`,
      )
      .bind(date)
      .first<Row>();
    if (!r) return null;
    return {
      date: r.date,
      engineVersion: r.engine_version,
      inputsHash: r.inputs_hash,
      readinessScore: r.readiness_score,
      readinessBand: r.readiness_band,
      confidence: r.confidence,
      dailyLoad: r.daily_load,
      atl: r.atl,
      ctl: r.ctl,
      tsb: r.tsb,
      acwr: r.acwr,
      computedAt: r.computed_at,
    };
  }
}
