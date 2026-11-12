import type { ModifyRequest, Reason, TodayRecommendation } from '@coach/shared';
import { useState } from 'preact/hooks';
import { Icon, type IconName } from '../../components/Icon';

const STEPS_TO_QUALITY = new Set(['easy', 'tempo', 'threshold']);

export function ModifyBar({
  rec,
  busy,
  feedback,
  onModify,
}: {
  rec: TodayRecommendation;
  busy: boolean;
  feedback: { applied: boolean; reasons: Reason[] } | null;
  onModify: (req: ModifyRequest) => void;
}) {
  const [timeOpen, setTimeOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const w = rec.workout;
  const currentMin = Math.round(w.durationSec / 60);
  const harderLocked = !rec.harder.qualityAllowed && STEPS_TO_QUALITY.has(w.type);
  const quick = [20, 30, 45, 60].filter((m) => m < currentMin);

  const pill = (icon: IconName, label: string, req: ModifyRequest, extra?: { locked?: boolean; hint?: string }) => (
    <button
      type="button"
      class={`pill ${extra?.locked ? 'locked' : ''}`}
      disabled={busy}
      title={extra?.hint}
      onClick={() => {
        setTimeOpen(false);
        onModify(req);
      }}
    >
      <Icon name={extra?.locked ? 'lock' : icon} size={18} />
      {label}
    </button>
  );

  const submitCustom = (e: Event) => {
    e.preventDefault();
    const m = Number.parseInt(custom, 10);
    if (Number.isFinite(m)) {
      onModify({ kind: 'time_limit', minutes: m });
      setTimeOpen(false);
    }
  };

  return (
    <section class="card" aria-labelledby="modify-title">
      <h2 class="card-title" id="modify-title">
        Adjust <span class="aside">the engine checks every change</span>
      </h2>
      <div class="modify">
        {w.type !== 'rest' ? pill('shorter', 'Shorter', { kind: 'shorter' }) : null}
        {w.type !== 'rest' ? pill('easier', 'Easier', { kind: 'easier' }) : null}
        {pill('harder', 'Harder', { kind: 'harder' }, harderLocked ? { locked: true, hint: rec.harder.blockedBy.map((r) => r.message).join(' ') } : undefined)}
        {w.type !== 'rest' ? (
          <button type="button" class="pill" disabled={busy} aria-expanded={timeOpen} onClick={() => setTimeOpen(!timeOpen)}>
            <Icon name="clock" size={18} />I only have…
          </button>
        ) : null}
        {w.type !== 'rest' ? pill('rest', 'Rest day', { kind: 'rest' }) : null}
        {pill('swap', 'Alternative', { kind: 'alternative' })}

        {timeOpen ? (
          <form class="time-picker" onSubmit={submitCustom}>
            {quick.map((m) => (
              <button key={m} type="button" class="pill" disabled={busy} onClick={() => { setTimeOpen(false); onModify({ kind: 'time_limit', minutes: m }); }}>
                {m} min
              </button>
            ))}
            <label class="sr-only" for="minutes">Minutes available</label>
            <input
              id="minutes"
              inputMode="numeric"
              type="number"
              min={10}
              max={currentMin}
              placeholder="min"
              value={custom}
              onInput={(e) => setCustom((e.target as HTMLInputElement).value)}
            />
            <button type="submit" class="pill primary" disabled={busy || !custom}>
              Fit
            </button>
          </form>
        ) : null}
      </div>

      {harderLocked && !feedback ? (
        <p class="muted" style={{ margin: '12px 0 0', fontSize: '14px' }}>
          <Icon name="lock" size={14} /> A harder session isn't available today: {rec.harder.blockedBy[0]?.message.toLowerCase()}
        </p>
      ) : null}

      {feedback ? (
        <div class="feedback" role="status">
          <strong>{feedback.applied ? 'Updated.' : 'Not changed.'}</strong> {feedback.reasons[0]?.message}
          {feedback.reasons.length > 1 ? (
            <ul>
              {feedback.reasons.slice(1).map((r, i) => (
                <li key={i}>{r.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
