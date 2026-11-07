import type { VatBasis, VatMode } from './types';

/**
 * Converts an amount (agorot) entered with `mode` to the display `basis`.
 * Exempt amounts and amounts already on the requested basis are returned as is.
 */
export function toBasis(amount: number, mode: VatMode, basis: VatBasis, vatRatePct: number): number {
  if (mode === 'exempt' || mode === basis) return amount;
  const factor = 1 + vatRatePct / 100;
  return mode === 'incl' ? Math.round(amount / factor) : Math.round(amount * factor);
}
