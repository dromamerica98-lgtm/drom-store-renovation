import type { TodayResponse } from '@coach/shared';
import { Status, type Tone } from '../../components/Status';
import * as f from '../../format';
import { Tile } from './Readiness';

const LOAD: Record<TodayResponse['load']['status'], { tone: Tone; label: string; text: string }> = {
  unknown: { tone: 'neutral', label: 'Building history', text: 'Needs 3 weeks of data' },
  low: { tone: 'neutral', label: 'Below usual', text: 'Room to build' },
  balanced: { tone: 'good', label: 'Balanced', text: 'In your productive range' },
  high: { tone: 'warning', label: 'High', text: 'Above your usual' },
  spike: { tone: 'critical', label: 'Spike', text: 'Sharp jump — injury risk' },
};

const CLASS_LABEL: Record<string, string> = { easy: 'Easy', moderate: 'Moderate', hard: 'Hard', long: 'Long', rest: 'Rest' };

export function TrainingTiles({ data }: { data: TodayResponse }) {
  const { load } = data;
  const s = LOAD[load.status];
  const form: { tone: Tone; label: string } =
    load.tsb > 5 ? { tone: 'good', label: 'Fresh' } : load.tsb < -10 ? { tone: 'warning', label: 'Carrying fatigue' } : { tone: 'neutral', label: 'Neutral' };
  return (
    <div class="tiles">
      <Tile
        label="Training load"
        value={load.acwr === null ? '—' : <>{load.acwr.toFixed(2)} <small>ratio</small></>}
        delta={`7-day ${Math.round(load.atl)} vs 6-week ${Math.round(load.ctl)}`}
        note={s.text}
        status={{ tone: s.tone, label: s.label }}
      />
      <Tile
        label="Form"
        value={f.signed(load.tsb)}
        delta={`Fitness ${Math.round(load.ctl)} · fatigue ${Math.round(load.atl)}`}
        note="Fitness minus fatigue; positive means fresher"
        status={form}
      />
    </div>
  );
}

export function YesterdayCard({ data }: { data: TodayResponse }) {
  const y = data.yesterday;
  return (
    <section class="card" aria-labelledby="yesterday-title">
      <h2 class="card-title" id="yesterday-title">
        Yesterday <span class="aside">{f.longDate(y.date)}</span>
      </h2>
      {y.activities.length === 0 ? (
        <p class="secondary" style={{ margin: 0 }}>Rest day — no activities recorded.</p>
      ) : (
        y.activities.map((a) => (
          <div class="activity" key={a.id}>
            <div>
              <div class="name">{a.name ?? a.sport}</div>
              <div class="meta">
                {f.duration(a.durationSec)}
                {a.distanceM ? ` · ${f.km(a.distanceM)}` : ''}
                {a.avgHr ? ` · ${a.avgHr} bpm avg` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span class="chip">{CLASS_LABEL[a.intensityClass]}</span>
              <div class="meta" style={{ marginTop: '4px' }}>load {Math.round(a.load)}</div>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

export function WeekCard({ data }: { data: TodayResponse }) {
  const { last7, previous7, avgWeek28 } = data.week;
  const split = data.week.intensity28;
  const kpi = (label: string, v: string, cur: number, prev: number) => (
    <div class="kpi">
      <div class="v">{v}</div>
      <div class="l">{label}</div>
      <div class="d">{prev > 0 ? `${f.percentDelta(cur, prev)} vs prev.` : '—'}</div>
    </div>
  );
  return (
    <section class="card" aria-labelledby="week-title">
      <h2 class="card-title" id="week-title">
        Weekly volume <span class="aside">last 7 days</span>
      </h2>
      <div class="kpis">
        {kpi('Time', f.durationCompact(last7.durationSec), last7.durationSec, previous7.durationSec)}
        {kpi('Distance', f.km(last7.distanceM, 0), last7.distanceM, previous7.distanceM)}
        {kpi('Sessions', String(last7.sessions), last7.sessions, previous7.sessions)}
      </div>
      <p class="muted" style={{ margin: '10px 0 0', fontSize: '13px' }}>
        4-week average: {f.durationCompact(avgWeek28.durationSec)} · {f.km(avgWeek28.distanceM, 0)} · {avgWeek28.sessions} sessions per week
      </p>
      {split ? (
        <>
          <div class="split" role="img" aria-label={`Intensity over 28 days: low ${Math.round(split.low * 100)}%, moderate ${Math.round(split.moderate * 100)}%, high ${Math.round(split.high * 100)}%`}>
            <span style={{ flexGrow: split.low, background: 'var(--z1)' }} title={`Zones 1–2: ${Math.round(split.low * 100)}%`} />
            <span style={{ flexGrow: split.moderate, background: 'var(--z3)' }} title={`Zone 3: ${Math.round(split.moderate * 100)}%`} />
            <span style={{ flexGrow: split.high, background: 'var(--z5)' }} title={`Zones 4–5: ${Math.round(split.high * 100)}%`} />
          </div>
          <div class="split-legend">
            <span><i class="swatch" style={{ background: 'var(--z1)' }} />Easy (Z1–2) {Math.round(split.low * 100)}%</span>
            <span><i class="swatch" style={{ background: 'var(--z3)' }} />Moderate (Z3) {Math.round(split.moderate * 100)}%</span>
            <span><i class="swatch" style={{ background: 'var(--z5)' }} />Hard (Z4–5) {Math.round(split.high * 100)}%</span>
          </div>
          <p class="muted" style={{ margin: '6px 0 0', fontSize: '12px' }}>Time in HR zones, last 28 days.</p>
        </>
      ) : null}
    </section>
  );
}

export function FlagAlert({ data }: { data: TodayResponse }) {
  const serious = data.flags.filter((x) => x.severity === 'critical' || x.severity === 'warning');
  if (serious.length === 0) return null;
  const critical = serious.filter((x) => x.severity === 'critical');
  const shown = critical.length ? critical : serious;
  return (
    <div class="alert" role="alert">
      <Status tone={critical.length ? 'critical' : 'serious'} label="" />
      <div>
        <strong>{critical.length ? 'Take it easy today' : 'Heads up'}</strong>
        {shown.map((x) => x.message).join(' ')}
      </div>
    </div>
  );
}
