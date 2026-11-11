import { useSearchParams } from 'react-router';
import { ZONE_LABELS, ZONE_ORDER, isZone } from '../../shared/labels';
import type { Zone } from '../../shared/types';

export type ZoneChoice = Zone | 'all';

/** The selected zone, kept in the address (?zone=…) so it survives reloads and the back button. */
export function useZoneFilter(): [ZoneChoice, (zone: ZoneChoice) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get('zone');
  const zone: ZoneChoice = isZone(value) ? value : 'all';
  const setZone = (next: ZoneChoice) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'all') p.delete('zone');
        else p.set('zone', next);
        return p;
      },
      { replace: true },
    );
  return [zone, setZone];
}

export function ZoneFilter({ value, onChange, allLabel = 'כל הפרויקט' }: { value: ZoneChoice; onChange: (z: ZoneChoice) => void; allLabel?: string }) {
  const options: { value: ZoneChoice; label: string }[] = [
    { value: 'all', label: allLabel },
    ...ZONE_ORDER.map((z) => ({ value: z as ZoneChoice, label: ZONE_LABELS[z] })),
  ];
  return (
    <div className="segmented zone-filter" role="group" aria-label="אזור בפרויקט">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.value !== 'all' && <i className={`zone-dot zone-${o.value}`} aria-hidden="true" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
