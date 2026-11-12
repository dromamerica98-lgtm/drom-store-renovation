import type { ModifyRequest, Reason, TodayResponse } from '@coach/shared';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../../api';
import { Icon } from '../../components/Icon';
import { Topbar } from '../../components/Topbar';
import * as f from '../../format';
import { ModifyBar } from './Modify';
import { ReadinessCard, RecoveryTiles } from './Readiness';
import { FlagAlert, TrainingTiles, WeekCard, YesterdayCard } from './Training';
import { WhyCard } from './Why';
import { WorkoutCard } from './Workout';

const SCENARIOS = ['normal', 'well_rested', 'fatigued', 'illness', 'calibrating'] as const;

export function TodayScreen() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ applied: boolean; reasons: Reason[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.today();
      setData(res.data);
      setOffline(res.offline);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<{ data: TodayResponse }>, keepFeedback = false) => {
    setBusy(true);
    try {
      const res = await fn();
      setData(res.data);
      setFeedback(keepFeedback ? (res.data.modificationResult ?? null) : null);
    } catch (e) {
      setFeedback({ applied: false, reasons: [{ code: 'ERROR', tone: 'warning', message: e instanceof Error ? e.message : 'Request failed.' }] });
    } finally {
      setBusy(false);
    }
  };

  const modify = (req: ModifyRequest) => run(() => api.modify(req), true);
  const reset = () => run(() => api.reset());

  const sync = async () => {
    setSyncing(true);
    try {
      await api.sync();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const switchScenario = async (scenario: string) => {
    setSyncing(true);
    try {
      await api.mockReset(scenario);
      setFeedback(null);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const sub = data ? (
    <>
      {f.longDate(data.date)}
      {data.lastSyncAt ? <span class="muted"> · synced {f.relativeTime(data.lastSyncAt)}</span> : null}
    </>
  ) : (
    'Loading…'
  );

  return (
    <>
      <Topbar title="Today" sub={sub}>
        <button class="icon-btn" type="button" aria-label="Sync with Garmin" aria-busy={syncing} onClick={sync} disabled={syncing}>
          <Icon name="refresh" size={20} />
        </button>
      </Topbar>
      <main>
        {offline ? <div class="offline">Offline — showing your last synced data.</div> : null}
        {error && !data ? (
          <div class="empty">
            <h2>Couldn't load today</h2>
            <p>{error}</p>
            <button class="pill" type="button" onClick={load}>
              Try again
            </button>
          </div>
        ) : !data ? (
          <TodaySkeleton />
        ) : (
          <>
            <FlagAlert data={data} />
            <div class="today-grid">
              <section class="area-readiness" aria-label="Readiness">
                <ReadinessCard data={data} />
              </section>
              <section class="area-plan stack" aria-label="Plan">
                <WorkoutCard rec={data.recommendation} onReset={reset} busy={busy} />
                <ModifyBar rec={data.recommendation} busy={busy} feedback={feedback} onModify={modify} />
                <WhyCard data={data} />
              </section>
              <section class="area-tiles" aria-label="Recovery details">
                <RecoveryTiles data={data} />
              </section>
              <section class="area-training stack" aria-label="Training">
                <TrainingTiles data={data} />
                <YesterdayCard data={data} />
                <WeekCard data={data} />
              </section>
            </div>
            <footer class="footer">
              <span>Engine {data.engineVersion}</span>
              {data.garminMode === 'mock' ? (
                <label>
                  Demo data:{' '}
                  <select disabled={syncing} onChange={(e) => switchScenario((e.target as HTMLSelectElement).value)} aria-label="Demo data scenario">
                    <option value="" selected disabled>
                      choose a scenario…
                    </option>
                    {SCENARIOS.map((s) => (
                      <option key={s} value={s}>
                        {f.capitalize(s.replace('_', ' '))}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span>Garmin connected</span>
              )}
            </footer>
          </>
        )}
      </main>
    </>
  );
}

function TodaySkeleton() {
  return (
    <div class="today-grid" aria-busy="true" aria-label="Loading">
      <section class="area-readiness">
        <div class="skeleton" style={{ height: '190px' }} />
      </section>
      <section class="area-plan stack">
        <div class="skeleton" style={{ height: '420px' }} />
      </section>
    </div>
  );
}
