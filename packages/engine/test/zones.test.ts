import { describe, expect, it } from 'vitest';
import { resolveZones } from '../src/zones';
import { settings } from './fixtures';

describe('zones', () => {
  it('prefers zones set in Settings', () => {
    const hrZones = [1, 2, 3, 4, 5].map((z) => ({ zone: z as 1, name: `Z${z}`, min: 100 + z * 10, max: 109 + z * 10 }));
    expect(resolveZones(settings({ hrZones }), 2026)).toMatchObject({ hrSource: 'settings', hr: hrZones });
  });

  it('derives from LTHR before max HR', () => {
    const z = resolveZones(settings({ lthr: 170 }), 2026);
    expect(z.hrSource).toBe('lthr');
    expect(z.hr![3]).toMatchObject({ zone: 4, min: 162, max: 169 });
  });

  it('derives Garmin-style %max zones from max HR', () => {
    const z = resolveZones(settings(), 2026);
    expect(z.hrSource).toBe('max_hr');
    expect(z.hr![1]).toMatchObject({ zone: 2, min: 113, max: 131 });
    expect(z.hr![4]).toMatchObject({ zone: 5, min: 169, max: 188 });
  });

  it('falls back to an age estimate, then to nothing', () => {
    expect(resolveZones(settings({ maxHr: null, birthYear: 1986 }), 2026).hr![4]!.max).toBe(180);
    expect(resolveZones(settings({ maxHr: null }), 2026)).toMatchObject({ hr: null, hrSource: 'none' });
  });

  it('derives pace zones from threshold pace (fast end first)', () => {
    const z = resolveZones(settings({ thresholdPaceSecPerKm: 300 }), 2026);
    expect(z.paceSource).toBe('threshold_pace');
    expect(z.pace![1]).toMatchObject({ zone: 2, min: 345, max: 390 });
  });
});
