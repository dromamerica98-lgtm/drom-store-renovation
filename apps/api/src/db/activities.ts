import type { IsoDate, Sport, ZoneTimes } from '@coach/engine';
import type { ActivityDetailsRecord, ActivityLap, ActivityRecord, ActivityStreams, WithRaw, WriteMeta } from '../domain/records';
import { type Column, bool, n, parseJson, runInBatches, toJson, upsertStatement } from './sql';

type ActivityRow = {
  id: number;
  start_at: string;
  start_local: string;
  local_date: string;
  sport: Sport;
  garmin_type_key: string | null;
  name: string | null;
  duration_sec: number;
  moving_duration_sec: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_speed_mps: number | null;
  max_speed_mps: number | null;
  avg_power_w: number | null;
  normalized_power_w: number | null;
  avg_cadence: number | null;
  calories: number | null;
  aerobic_te: number | null;
  anaerobic_te: number | null;
  garmin_load: number | null;
  time_in_z1_sec: number | null;
  time_in_z2_sec: number | null;
  time_in_z3_sec: number | null;
  time_in_z4_sec: number | null;
  time_in_z5_sec: number | null;
  rpe: number | null;
  has_details: number;
};

const zone = (i: 0 | 1 | 2 | 3 | 4) => (r: ActivityRecord) => (r.timeInZonesSec ? r.timeInZonesSec[i] : null);

const ACTIVITY_COLUMNS: Column<WithRaw<ActivityRecord>>[] = [
  ['id', (r) => r.id],
  ['start_at', (r) => r.startAt],
  ['start_local', (r) => r.startLocal],
  ['local_date', (r) => r.localDate],
  ['sport', (r) => r.sport],
  ['garmin_type_key', (r) => n(r.garminTypeKey)],
  ['name', (r) => n(r.name)],
  ['duration_sec', (r) => r.durationSec],
  ['moving_duration_sec', (r) => n(r.movingDurationSec)],
  ['distance_m', (r) => n(r.distanceM)],
  ['elevation_gain_m', (r) => n(r.elevationGainM)],
  ['avg_hr', (r) => n(r.avgHr)],
  ['max_hr', (r) => n(r.maxHr)],
  ['avg_speed_mps', (r) => n(r.avgSpeedMps)],
  ['max_speed_mps', (r) => n(r.maxSpeedMps)],
  ['avg_power_w', (r) => n(r.avgPowerW)],
  ['normalized_power_w', (r) => n(r.normalizedPowerW)],
  ['avg_cadence', (r) => n(r.avgCadence)],
  ['calories', (r) => n(r.calories)],
  ['aerobic_te', (r) => n(r.aerobicTe)],
  ['anaerobic_te', (r) => n(r.anaerobicTe)],
  ['garmin_load', (r) => n(r.garminLoad)],
  ['time_in_z1_sec', zone(0)],
  ['time_in_z2_sec', zone(1)],
  ['time_in_z3_sec', zone(2)],
  ['time_in_z4_sec', zone(3)],
  ['time_in_z5_sec', zone(4)],
  // rpe and has_details are owned by the app, not the provider: see upsertMany.
];

function toRecord(r: ActivityRow): ActivityRecord {
  const z = [r.time_in_z1_sec, r.time_in_z2_sec, r.time_in_z3_sec, r.time_in_z4_sec, r.time_in_z5_sec];
  return {
    id: r.id,
    startAt: r.start_at,
    startLocal: r.start_local,
    localDate: r.local_date,
    sport: r.sport,
    garminTypeKey: r.garmin_type_key,
    name: r.name,
    durationSec: r.duration_sec,
    movingDurationSec: r.moving_duration_sec,
    distanceM: r.distance_m,
    elevationGainM: r.elevation_gain_m,
    avgHr: r.avg_hr,
    maxHr: r.max_hr,
    avgSpeedMps: r.avg_speed_mps,
    maxSpeedMps: r.max_speed_mps,
    avgPowerW: r.avg_power_w,
    normalizedPowerW: r.normalized_power_w,
    avgCadence: r.avg_cadence,
    calories: r.calories,
    aerobicTe: r.aerobic_te,
    anaerobicTe: r.anaerobic_te,
    garminLoad: r.garmin_load,
    timeInZonesSec: z.every((v) => v !== null) ? (z as ZoneTimes) : null,
    rpe: r.rpe,
    hasDetails: bool(r.has_details),
  };
}

export class ActivityRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Upserts provider data. User-owned columns (rpe) and has_details are never
   * overwritten by a re-sync because they are not in the column list.
   */
  async upsertMany(rows: WithRaw<ActivityRecord>[], meta: WriteMeta): Promise<number> {
    const columns: Column<WithRaw<ActivityRecord>>[] = [
      ...ACTIVITY_COLUMNS,
      ['raw_json', (r) => toJson(r.raw)],
      ['source', () => meta.source],
      ['fetched_at', () => meta.fetchedAt],
      ['updated_at', () => meta.fetchedAt],
    ];
    await runInBatches(
      this.db,
      rows.map((r) => upsertStatement(this.db, 'activities', ['id'], columns, r)),
    );
    return rows.length;
  }

  /** Activities whose local date is within [from, to], oldest first. */
  async listBetween(from: IsoDate, to: IsoDate): Promise<ActivityRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM activities WHERE local_date BETWEEN ?1 AND ?2 ORDER BY start_at')
      .bind(from, to)
      .all<ActivityRow>();
    return results.map(toRecord);
  }

  async getById(id: number): Promise<ActivityRecord | null> {
    const row = await this.db.prepare('SELECT * FROM activities WHERE id = ?1').bind(id).first<ActivityRow>();
    return row ? toRecord(row) : null;
  }

  /** Ids in the range that have no stored details yet (for the detail sync). */
  async idsMissingDetails(from: IsoDate, to: IsoDate): Promise<number[]> {
    const { results } = await this.db
      .prepare('SELECT id FROM activities WHERE has_details = 0 AND local_date BETWEEN ?1 AND ?2 ORDER BY start_at')
      .bind(from, to)
      .all<{ id: number }>();
    return results.map((r) => r.id);
  }

  async upsertDetails(details: ActivityDetailsRecord, meta: WriteMeta): Promise<void> {
    const columns: Column<ActivityDetailsRecord>[] = [
      ['activity_id', (r) => r.activityId],
      ['laps_json', (r) => toJson(r.laps)],
      ['streams_json', (r) => toJson(r.streams)],
      ['fit_object_key', (r) => n(r.fitObjectKey)],
      ['fit_size_bytes', (r) => n(r.fitSizeBytes)],
      ['source', () => meta.source],
      ['fetched_at', () => meta.fetchedAt],
      ['updated_at', () => meta.fetchedAt],
    ];
    await this.db.batch([
      upsertStatement(this.db, 'activity_details', ['activity_id'], columns, details),
      this.db.prepare('UPDATE activities SET has_details = 1 WHERE id = ?1').bind(details.activityId),
    ]);
  }

  async getDetails(activityId: number): Promise<ActivityDetailsRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM activity_details WHERE activity_id = ?1')
      .bind(activityId)
      .first<{ activity_id: number; laps_json: string | null; streams_json: string | null; fit_object_key: string | null; fit_size_bytes: number | null }>();
    if (!row) return null;
    return {
      activityId: row.activity_id,
      laps: parseJson<ActivityLap[]>(row.laps_json),
      streams: parseJson<ActivityStreams>(row.streams_json),
      fitObjectKey: row.fit_object_key,
      fitSizeBytes: row.fit_size_bytes,
    };
  }
}
