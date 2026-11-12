/** Deterministic randomness: the same seed always yields the same sequence. */

/** FNV-1a 32-bit string hash. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform [0, 1). */
  next(): number;
  /** Normal(mean, sd) via Box–Muller. */
  normal(mean?: number, sd?: number): number;
  chance(p: number): boolean;
}

/** mulberry32 PRNG seeded from a string. */
export function rng(seed: string): Rng {
  let a = hashString(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    normal(mean = 0, sd = 1) {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    chance(p) {
      return next() < p;
    },
  };
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const round = (value: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};
