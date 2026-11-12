/** Destructive maintenance used only by the mock-mode dev reset. */
export async function clearGarminAndEngineData(db: D1Database): Promise<void> {
  const tables = [
    'coach_messages',
    'recommendations',
    'daily_assessments',
    'activity_details',
    'activities',
    'intraday_series',
    'daily_summary',
    'sleep_daily',
    'hrv_daily',
    'body_battery_daily',
    'stress_daily',
    'sync_state',
    'sync_runs',
  ];
  await db.batch(tables.map((t) => db.prepare(`DELETE FROM ${t}`)));
}
