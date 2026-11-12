import type { TodayRecommendation, Workout, WorkoutStep } from '@coach/shared';
import { Icon } from '../../components/Icon';
import * as f from '../../format';
import { INTENSITY_LABEL, MOD_LABEL, MODALITY_LABEL, ZONE_COLOR } from './labels';

function TargetLine({ step, modality }: { step: WorkoutStep; modality: Workout['modality'] }) {
  const t = step.target;
  return (
    <div class="targets">
      {t.zone ? <span>Zone {t.zone}{t.zoneName ? ` · ${t.zoneName}` : ''}</span> : null}
      {t.hrBpm ? <span>{t.hrBpm[0]}–{t.hrBpm[1]} bpm</span> : null}
      {t.paceSecPerKm && modality === 'run' ? <span>{f.pace(t.paceSecPerKm[0])}–{f.pace(t.paceSecPerKm[1])} /km</span> : null}
      <span>RPE {t.rpe[0]}–{t.rpe[1]}</span>
    </div>
  );
}

function StepRow({ step, modality }: { step: WorkoutStep; modality: Workout['modality'] }) {
  return (
    <li class="step">
      <span class="bar" style={{ background: ZONE_COLOR(step.target.zone) }} aria-hidden="true" />
      <span class="name">{step.label}</span>
      <span class="time">{f.duration(step.durationSec)}</span>
      <TargetLine step={step} modality={modality} />
      <span class="cue">{step.target.cue}</span>
    </li>
  );
}

/** Proportional strip of the session: width = time, height and colour = zone. */
function Timeline({ workout }: { workout: Workout }) {
  const segments: WorkoutStep[] = workout.blocks.flatMap((b) =>
    b.kind === 'repeat' ? Array.from({ length: b.times }, () => b.steps).flat() : [b],
  );
  return (
    <>
      <div class="timeline" role="img" aria-label={`Session profile: ${segments.map((s) => `${f.duration(s.durationSec)} zone ${s.target.zone ?? '-'}`).join(', ')}`}>
        {segments.map((s, i) => (
          <span
            key={i}
            title={`${s.label} · ${f.duration(s.durationSec)}${s.target.zone ? ` · Zone ${s.target.zone}` : ''}`}
            style={{ flexGrow: s.durationSec, height: `${30 + (s.target.zone ?? 1) * 14}%`, background: ZONE_COLOR(s.target.zone) }}
          />
        ))}
      </div>
      <div class="timeline-axis" aria-hidden="true">
        <span>0</span>
        <span>{f.duration(workout.durationSec)}</span>
      </div>
    </>
  );
}

export function WorkoutCard({ rec, onReset, busy }: { rec: TodayRecommendation; onReset: () => void; busy: boolean }) {
  const w = rec.workout;
  const isRest = w.type === 'rest';
  return (
    <section class="card" aria-labelledby="workout-title">
      <h2 class="card-title">
        Today's workout <span class="aside">{rec.modifications.length ? 'adjusted' : 'recommended'}</span>
      </h2>
      <div class="workout-head">
        <h2 id="workout-title">{w.title}</h2>
        {!isRest ? <span class="duration">{f.duration(w.durationSec)}</span> : null}
      </div>
      <div class="chips">
        <span class="chip">{INTENSITY_LABEL[w.intensity]}</span>
        {w.primaryZone ? (
          <span class="chip">
            <span class="swatch" style={{ background: ZONE_COLOR(w.primaryZone), margin: 0 }} />
            Zone {w.primaryZone}
          </span>
        ) : null}
        {!isRest ? <span class="chip">{MODALITY_LABEL[w.modality]}</span> : null}
      </div>
      <p class="workout-summary">{w.summary}</p>

      {rec.original ? (
        <div class="modified">
          <span>
            {rec.modifications.map((m) => (m.kind === 'time_limit' ? `${m.minutes} min limit` : MOD_LABEL[m.kind])).join(' → ')}
            <span class="secondary"> · was {rec.original.title.toLowerCase()}{rec.original.durationSec ? `, ${f.duration(rec.original.durationSec)}` : ''}</span>
          </span>
          <button class="link-btn" type="button" onClick={onReset} disabled={busy}>
            Undo
          </button>
        </div>
      ) : null}

      {w.blocks.length ? <Timeline workout={w} /> : null}

      {w.blocks.length ? (
        <ol class="steps" aria-label="Workout steps">
          {w.blocks.map((b, i) =>
            b.kind === 'repeat' ? (
              <li key={i}>
                <ol class="repeat">
                  <li class="repeat-head">
                    <span>Repeat {b.times}×</span>
                    <span class="secondary">{f.duration(b.times * b.steps.reduce((s, x) => s + x.durationSec, 0))}</span>
                  </li>
                  {b.steps.map((s, j) => (
                    <StepRow key={j} step={s} modality={w.modality} />
                  ))}
                </ol>
              </li>
            ) : (
              <StepRow key={i} step={b} modality={w.modality} />
            ),
          )}
        </ol>
      ) : null}

      {w.notes.length ? (
        <ul class="notes">
          {w.notes.map((n, i) => (
            <li key={i}>
              <Icon name="info" size={14} /> {n}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
