import type {
  IsoDate,
  IsoTimestamp,
  ModificationKind,
  Reason,
  Recommendation,
  RuleId,
  Workout,
} from '@coach/engine';

export interface StoredRecommendation {
  id: number;
  date: IsoDate;
  parentId: number | null;
  origin: 'engine' | 'modification';
  modificationKind: ModificationKind | null;
  modificationMinutes: number | null;
  engineVersion: string;
  inputsHash: string;
  ruleId: RuleId;
  workout: Workout;
  /** Engine rows: the decision's reasons. Modification rows: the modification's reasons. */
  reasons: Reason[];
  isCurrent: boolean;
  status: 'proposed' | 'completed' | 'skipped';
  createdAt: IsoTimestamp;
}

type Row = {
  id: number;
  date: string;
  parent_id: number | null;
  origin: 'engine' | 'modification';
  modification_kind: ModificationKind | null;
  modification_minutes: number | null;
  engine_version: string;
  inputs_hash: string;
  rule_id: RuleId;
  workout_json: string;
  reasons_json: string;
  is_current: number;
  status: StoredRecommendation['status'];
  created_at: string;
};

const toStored = (r: Row): StoredRecommendation => ({
  id: r.id,
  date: r.date,
  parentId: r.parent_id,
  origin: r.origin,
  modificationKind: r.modification_kind,
  modificationMinutes: r.modification_minutes,
  engineVersion: r.engine_version,
  inputsHash: r.inputs_hash,
  ruleId: r.rule_id,
  workout: JSON.parse(r.workout_json) as Workout,
  reasons: JSON.parse(r.reasons_json) as Reason[],
  isCurrent: r.is_current === 1,
  status: r.status,
  createdAt: r.created_at,
});

const INSERT = `INSERT INTO recommendations
  (date, parent_id, origin, modification_kind, modification_minutes, engine_version, inputs_hash, rule_id,
   workout_type, duration_min, workout_json, reasons_json, is_current, created_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13) RETURNING *`;

/**
 * Every recommendation ever made, with modification lineage.
 * Exactly one row per date is current (enforced by a partial unique index).
 */
export class RecommendationRepository {
  constructor(private readonly db: D1Database) {}

  async getCurrent(date: IsoDate): Promise<StoredRecommendation | null> {
    const row = await this.db
      .prepare('SELECT * FROM recommendations WHERE date = ?1 AND is_current = 1')
      .bind(date)
      .first<Row>();
    return row ? toStored(row) : null;
  }

  async getById(id: number): Promise<StoredRecommendation | null> {
    const row = await this.db.prepare('SELECT * FROM recommendations WHERE id = ?1').bind(id).first<Row>();
    return row ? toStored(row) : null;
  }

  /** The chain from the engine's original recommendation to `id`, oldest first. */
  async lineage(id: number): Promise<StoredRecommendation[]> {
    const chain: StoredRecommendation[] = [];
    let next: number | null = id;
    while (next !== null && chain.length < 50) {
      const rec = await this.getById(next);
      if (!rec) break;
      chain.unshift(rec);
      next = rec.parentId;
    }
    return chain;
  }

  private async insertCurrent(date: IsoDate, values: Array<string | number | null>): Promise<StoredRecommendation> {
    const [, inserted] = await this.db.batch([
      this.db.prepare('UPDATE recommendations SET is_current = 0 WHERE date = ?1 AND is_current = 1').bind(date),
      this.db.prepare(INSERT).bind(...values),
    ]);
    const row = inserted?.results[0] as Row | undefined;
    if (!row) throw new Error('failed to insert recommendation');
    return toStored(row);
  }

  /** Stores the engine's recommendation for `date` and makes it current. */
  insertEngine(
    date: IsoDate,
    rec: Recommendation,
    meta: { engineVersion: string; inputsHash: string; now: IsoTimestamp },
  ): Promise<StoredRecommendation> {
    return this.insertCurrent(date, [
      date,
      null,
      'engine',
      null,
      null,
      meta.engineVersion,
      meta.inputsHash,
      rec.ruleId,
      rec.workout.type,
      Math.round(rec.workout.durationSec / 60),
      JSON.stringify(rec.workout),
      JSON.stringify(rec.reasons),
      meta.now,
    ]);
  }

  /** Stores a modification of `parent` and makes it current. */
  insertModification(
    parent: StoredRecommendation,
    change: { kind: ModificationKind; minutes: number | null; workout: Workout; reasons: Reason[] },
    now: IsoTimestamp,
  ): Promise<StoredRecommendation> {
    return this.insertCurrent(parent.date, [
      parent.date,
      parent.id,
      'modification',
      change.kind,
      change.minutes,
      parent.engineVersion,
      parent.inputsHash,
      parent.ruleId,
      change.workout.type,
      Math.round(change.workout.durationSec / 60),
      JSON.stringify(change.workout),
      JSON.stringify(change.reasons),
      now,
    ]);
  }

  /** Makes an existing recommendation current again (e.g. reset to the engine's original). */
  async makeCurrent(rec: StoredRecommendation): Promise<void> {
    await this.db.batch([
      this.db.prepare('UPDATE recommendations SET is_current = 0 WHERE date = ?1 AND is_current = 1').bind(rec.date),
      this.db.prepare('UPDATE recommendations SET is_current = 1 WHERE id = ?1').bind(rec.id),
    ]);
  }
}
