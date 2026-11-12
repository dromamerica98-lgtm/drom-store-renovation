import { ActivityRepository } from './activities';
import { HealthRepository } from './health';
import { SettingsRepository } from './settings';
import { SyncRepository } from './sync';

export { ActivityRepository, HealthRepository, SettingsRepository, SyncRepository };

/** All repositories bound to one D1 database. */
export function repositories(db: D1Database) {
  return {
    settings: new SettingsRepository(db),
    health: new HealthRepository(db),
    activities: new ActivityRepository(db),
    sync: new SyncRepository(db),
  };
}

export type Repositories = ReturnType<typeof repositories>;
