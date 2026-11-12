import { ActivityRepository } from './activities';
import { AppStateRepository } from './app-state';
import { AssessmentRepository } from './assessments';
import { HealthRepository } from './health';
import { RecommendationRepository } from './recommendations';
import { SettingsRepository } from './settings';
import { SyncRepository } from './sync';

export { ActivityRepository, AppStateRepository, AssessmentRepository, HealthRepository, RecommendationRepository, SettingsRepository, SyncRepository };

/** All repositories bound to one D1 database. */
export function repositories(db: D1Database) {
  return {
    settings: new SettingsRepository(db),
    health: new HealthRepository(db),
    activities: new ActivityRepository(db),
    sync: new SyncRepository(db),
    assessments: new AssessmentRepository(db),
    recommendations: new RecommendationRepository(db),
    appState: new AppStateRepository(db),
  };
}

export type Repositories = ReturnType<typeof repositories>;
