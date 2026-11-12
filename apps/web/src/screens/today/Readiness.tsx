import type { TodayResponse } from '@coach/shared';
import { Icon } from '../../components/Icon';
import { Status } from '../../components/Status';
import * as f from '../../format';
import { BAND, componentStatus } from './labels';

export function ReadinessCard({ data }: { data: TodayResponse }) {
  const { readiness, flags } = data;
  const band = BAND[readiness.band];
  const calibrating = flags.find((x) => x.code === 'calibrating');
  return (
    <section class="card readiness" aria-labelledby="readiness-title">
      <h2 class="card-title" id="readiness-title">
        Readiness <span class="aside">vs your own baseline</span>
      </h2>
      <div class="hero">
        <div class="score" aria-label={readiness.score === null ? 'No readiness score' : `Readiness ${readiness.score} out of 100`}>
          {readiness.score ?? '—'}
          <span class="of"> /100</span>
        </div>
        <Status tone={band.tone} label={band.label} />
      </div>
      <div>
        <div class="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readiness.score ?? undefined} aria-label="Readiness">
          <span style={{ width: `${readiness.score ?? 0}%`, background: band.color }} />
        </div>
        <div class="meter-scale" aria-hidden="true">
          {[0, 35, 50, 65, 80, 100].map((v) => (
            <span key={v} style={{ left: `${v}%` }}>
              {v}
            </span>
          ))}
        </div>
      </div>
      {calibrating ? (
        <div class="calibrating">
          <Icon name="info" size={18} />
          <span>{calibrating.message}</span>
        </div>
      ) : null}
      {readiness.confidence < 1 && !calibrating ? (
        <p class="muted" style={{ margin: 0, fontSize: '13px' }}>
          Confidence {Math.round(readiness.confidence * 100)}% — some inputs are missing today.
        </p>
      ) : null}
    </section>
  );
}

/** Sleep, HRV, Body Battery and resting HR — each against the personal baseline. */
export function RecoveryTiles({ data }: { data: TodayResponse }) {
  const by = Object.fromEntries(data.readiness.components.map((c) => [c.key, c]));
  const sleep = by.sleep!;
  const hrv = by.hrv!;
  const bb = by.bodyBattery!;
  const rhr = by.restingHr!;
  const sleepScore = sleep.extra?.sleepScore ?? null;
  const sleepScoreBase = sleep.extra?.sleepScoreBaseline ?? null;
  const garminHrv = data.today?.hrvStatus;

  return (
    <div class="tiles">
      <Tile
        label="Sleep"
        value={sleep.value === null ? '—' : f.duration(sleep.value)}
        delta={sleep.value !== null && sleep.baseline !== null ? `${f.signed((sleep.value - sleep.baseline) / 60)} min vs usual` : null}
        note={sleepScore !== null ? `Score ${sleepScore}${sleepScoreBase !== null ? ` · usual ${sleepScoreBase}` : ''}` : null}
        status={componentStatus(sleep)}
      />
      <Tile
        label="HRV"
        value={hrv.value === null ? '—' : <>{Math.round(hrv.value)} <small>ms</small></>}
        delta={hrv.value !== null && hrv.baseline !== null ? `${f.percentDelta(hrv.value, hrv.baseline)} vs baseline ${Math.round(hrv.baseline)} ms` : null}
        note={garminHrv && garminHrv !== 'none' ? `Garmin status: ${garminHrv}` : null}
        status={componentStatus(hrv)}
      />
      <Tile
        label="Body Battery"
        value={bb.value === null ? '—' : <>{bb.value} <small>at wake</small></>}
        delta={bb.value !== null && bb.baseline !== null ? `${f.signed(bb.value - bb.baseline)} vs usual ${bb.baseline}` : null}
        note={data.today?.bodyBatteryHigh != null ? `Highest today ${data.today.bodyBatteryHigh}` : null}
        status={componentStatus(bb)}
      />
      <Tile
        label="Resting HR"
        value={rhr.value === null ? '—' : <>{rhr.value} <small>bpm</small></>}
        delta={rhr.value !== null && rhr.baseline !== null ? `${f.signed(rhr.value - rhr.baseline)} bpm vs usual ${Math.round(rhr.baseline)}` : null}
        note={null}
        status={componentStatus(rhr)}
      />
    </div>
  );
}

export function Tile(props: {
  label: string;
  value: preact.ComponentChildren;
  delta: string | null;
  note: string | null;
  status?: { tone: Parameters<typeof Status>[0]['tone']; label: string };
}) {
  return (
    <div class="tile">
      <div class="label">{props.label}</div>
      <div class="value">{props.value}</div>
      {props.delta ? <div class="delta">{props.delta}</div> : null}
      {props.status ? <Status tone={props.status.tone} label={props.status.label} /> : null}
      {props.note ? <div class="note">{props.note}</div> : null}
    </div>
  );
}
