/**
 * Status indicator: reserved status colour + icon + text label.
 * Colour never carries the meaning alone.
 */
import { Icon, type IconName } from './Icon';

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral';

const ICON: Record<Tone, IconName> = {
  good: 'check',
  warning: 'alert',
  serious: 'alert',
  critical: 'alert',
  neutral: 'minus',
};

export function Status({ tone, label, class: cls }: { tone: Tone; label: string; class?: string }) {
  return (
    <span class={`status ${tone} ${cls ?? ''}`}>
      <span class="dot">
        <Icon name={ICON[tone]} size={14} stroke={3} />
      </span>
      {label}
    </span>
  );
}
