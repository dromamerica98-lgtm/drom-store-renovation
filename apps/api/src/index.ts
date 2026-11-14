import { localDate } from '@coach/engine';
import { createApp } from './app';
import { repositories } from './db';
import type { Env } from './env';
import { providerFor } from './garmin';
import { SyncService } from './garmin/sync';

const app = createApp();

export default {
  fetch: app.fetch,

  /** Cron trigger: incremental Garmin sync (see wrangler.jsonc "triggers"). */
  async scheduled(_controller, env, ctx) {
    const repos = repositories(env.DB);
    const settings = await repos.settings.get();
    const today = localDate(new Date(), settings.timezone);
    ctx.waitUntil(
      new SyncService(repos, await providerFor(repos, env, today)).run({ trigger: 'cron', today }).then((r) => {
        // Messages are already sanitized by SyncService.
        if (r.status !== 'success') console.warn('Garmin sync finished with errors', r.errors);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
