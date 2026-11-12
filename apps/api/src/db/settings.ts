import type { AthleteSettings, IsoTimestamp, Weekday, Zone, ZoneNumber } from '@coach/engine';

type SettingsRow = {
  timezone: string;
  units: AthleteSettings['units'];
  primary_sport: AthleteSettings['primarySport'];
  goal_type: AthleteSettings['goalType'];
  goal_event_date: string | null;
  goal_notes: string | null;
  available_days: string;
  long_session_day: number | null;
  preferred_duration_min: number;
  max_duration_min: number;
  quality_sessions_per_week: number;
  max_hr: number | null;
  resting_hr_override: number | null;
  lthr: number | null;
  threshold_pace_sec_per_km: number | null;
  birth_year: number | null;
  sex: AthleteSettings['sex'];
};

type ZoneRow = { kind: 'hr' | 'pace'; zone: number; name: string; min_value: number; max_value: number };

/** Settings fields that live in the `settings` row (zones are separate). */
export type SettingsPatch = Partial<Omit<AthleteSettings, 'hrZones' | 'paceZones'>>;

const COLUMN_BY_FIELD: Record<keyof SettingsPatch, keyof SettingsRow> = {
  timezone: 'timezone',
  units: 'units',
  primarySport: 'primary_sport',
  goalType: 'goal_type',
  goalEventDate: 'goal_event_date',
  goalNotes: 'goal_notes',
  availableDays: 'available_days',
  longSessionDay: 'long_session_day',
  preferredDurationMin: 'preferred_duration_min',
  maxDurationMin: 'max_duration_min',
  qualitySessionsPerWeek: 'quality_sessions_per_week',
  maxHr: 'max_hr',
  restingHrOverride: 'resting_hr_override',
  lthr: 'lthr',
  thresholdPaceSecPerKm: 'threshold_pace_sec_per_km',
  birthYear: 'birth_year',
  sex: 'sex',
};

export class SettingsRepository {
  constructor(private readonly db: D1Database) {}

  async get(): Promise<AthleteSettings> {
    const [settingsResult, zonesResult] = await this.db.batch([
      this.db.prepare('SELECT * FROM settings WHERE id = 1'),
      this.db.prepare('SELECT kind, zone, name, min_value, max_value FROM training_zones ORDER BY kind, zone'),
    ]);
    const row = settingsResult?.results[0] as SettingsRow | undefined;
    if (!row) throw new Error('settings row missing — has migration 0001 been applied?');
    const zones = (zonesResult?.results ?? []) as ZoneRow[];
    const toZone = (z: ZoneRow): Zone => ({
      zone: z.zone as ZoneNumber,
      name: z.name,
      min: z.min_value,
      max: z.max_value,
    });
    return {
      timezone: row.timezone,
      units: row.units,
      primarySport: row.primary_sport,
      goalType: row.goal_type,
      goalEventDate: row.goal_event_date,
      goalNotes: row.goal_notes,
      availableDays: JSON.parse(row.available_days) as Weekday[],
      longSessionDay: row.long_session_day as Weekday | null,
      preferredDurationMin: row.preferred_duration_min,
      maxDurationMin: row.max_duration_min,
      qualitySessionsPerWeek: row.quality_sessions_per_week,
      maxHr: row.max_hr,
      restingHrOverride: row.resting_hr_override,
      lthr: row.lthr,
      thresholdPaceSecPerKm: row.threshold_pace_sec_per_km,
      birthYear: row.birth_year,
      sex: row.sex,
      hrZones: zones.filter((z) => z.kind === 'hr').map(toZone),
      paceZones: zones.filter((z) => z.kind === 'pace').map(toZone),
    };
  }

  async update(patch: SettingsPatch, now: IsoTimestamp): Promise<void> {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [field, value] of Object.entries(patch) as Array<[keyof SettingsPatch, unknown]>) {
      if (value === undefined) continue;
      const column = COLUMN_BY_FIELD[field];
      if (!column) continue;
      sets.push(`${column} = ?${values.length + 1}`);
      values.push(field === 'availableDays' ? JSON.stringify(value) : (value as string | number | null));
    }
    if (sets.length === 0) return;
    sets.push(`updated_at = ?${values.length + 1}`);
    values.push(now);
    await this.db.prepare(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`).bind(...values).run();
  }

  /** Replaces all zones of one kind atomically. */
  async replaceZones(kind: 'hr' | 'pace', zones: Zone[], now: IsoTimestamp): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM training_zones WHERE kind = ?1').bind(kind),
      ...zones.map((z) =>
        this.db
          .prepare(
            'INSERT INTO training_zones (kind, zone, name, min_value, max_value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
          )
          .bind(kind, z.zone, z.name, z.min, z.max, now),
      ),
    ]);
  }
}
