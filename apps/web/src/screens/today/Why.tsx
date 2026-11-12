import type { Reason, TodayResponse } from '@coach/shared';
import { Icon, type IconName } from '../../components/Icon';
import * as f from '../../format';
import { RULE_LABEL } from './labels';

const TONE_ICON: Record<Reason['tone'], { icon: IconName; color: string; label: string }> = {
  positive: { icon: 'check', color: 'var(--good-ink)', label: 'Supports' },
  neutral: { icon: 'info', color: 'var(--ink-2)', label: 'Context' },
  caution: { icon: 'alert', color: 'var(--serious)', label: 'Caution' },
  warning: { icon: 'alert', color: 'var(--critical)', label: 'Warning' },
};

function value(c: TodayResponse['readiness']['components'][number], v: number | null): string {
  if (v === null) return '—';
  if (c.unit === 's') return f.durationCompact(v);
  if (c.unit === 'ms') return `${Math.round(v)} ms`;
  if (c.unit === 'bpm') return `${Math.round(v)} bpm`;
  return String(Math.round(v));
}

export function WhyCard({ data }: { data: TodayResponse }) {
  const reasons = data.recommendation.reasons;
  return (
    <section class="card" aria-labelledby="why-title">
      <h2 class="card-title" id="why-title">
        Why this workout <span class="aside">
          {data.recommendation.ruleId.split('_')[0]} · {RULE_LABEL[data.recommendation.ruleId] ?? data.recommendation.ruleId}
        </span>
      </h2>
      <ul class="reasons">
        {reasons.map((r, i) => {
          const t = TONE_ICON[r.tone];
          return (
            <li key={r.code + i} class={`reason ${i === 0 ? 'decisive' : ''}`}>
              <span style={{ color: t.color }}>
                <Icon name={t.icon} size={20} label={t.label} stroke={2.4} />
              </span>
              <span>{r.message}</span>
            </li>
          );
        })}
      </ul>
      <details class="numbers">
        <summary>Show the numbers</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Today</th>
              <th scope="col">Your usual</th>
              <th scope="col">z</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {data.readiness.components.map((c) => (
              <tr key={c.key}>
                <td>{c.label}</td>
                <td>{value(c, c.value)}</td>
                <td>{value(c, c.baseline)}</td>
                <td>{c.z === null ? '—' : f.signed(c.z, 1)}</td>
                <td>{c.score ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="muted" style={{ fontSize: '12px' }}>
          Scores: 70 = your normal; each standard deviation better or worse moves it by 20. Weights: HRV 30 %, sleep 25 %, resting HR 20 %,
          Body Battery 15 %, stress 10 %. Engine {data.engineVersion}.
        </p>
      </details>
    </section>
  );
}
