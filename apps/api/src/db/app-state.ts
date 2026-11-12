import type { IsoTimestamp } from '@coach/engine';

/** Known keys and their value types. */
export interface AppStateValues {
  /** Mock mode: the scenario the stored mock data was generated with. */
  mock_scenario: string;
}

export class AppStateRepository {
  constructor(private readonly db: D1Database) {}

  async get<K extends keyof AppStateValues>(key: K): Promise<AppStateValues[K] | null> {
    const row = await this.db.prepare('SELECT value_json FROM app_state WHERE key = ?1').bind(key).first<{ value_json: string }>();
    return row ? (JSON.parse(row.value_json) as AppStateValues[K]) : null;
  }

  async set<K extends keyof AppStateValues>(key: K, value: AppStateValues[K], now: IsoTimestamp): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO app_state (key, value_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .bind(key, JSON.stringify(value), now)
      .run();
  }
}
