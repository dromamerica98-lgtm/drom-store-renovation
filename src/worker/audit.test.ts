import { describe, expect, it } from 'vitest';
import { formatILS } from '../shared/money';
import { diff, paymentLabel, snapshot } from './audit';

describe('audit helpers', () => {
  it('keeps item fields and drops bookkeeping columns and storage keys', () => {
    expect(
      snapshot({ id: 'x', name: 'חשמל', progress: 20, createdAt: 't', createdBy: 'a', updatedAt: 't', updatedBy: 'a', sortOrder: 3, r2Key: 'k' }),
    ).toEqual({ name: 'חשמל', progress: 20 });
  });

  it('records only the fields that changed, with before and after', () => {
    const before = { id: 'x', name: 'חשמל', progress: 20, estimateAmount: null, notes: null, updatedBy: 'a' };
    const after = { name: 'חשמל', progress: 60, estimateAmount: 500000, notes: null };
    expect(diff(before, after)).toEqual({ progress: [20, 60], estimateAmount: [null, 500000] });
    expect(diff(before, { name: 'חשמל', progress: 20 })).toEqual({});
  });

  it('labels payments by amount and what they are for', () => {
    expect(paymentLabel({ amount: 500000, workAreaId: 'a1' }, { a1: 'חשמל' })).toBe(`${formatILS(500000)} · חשמל`);
  });
});
