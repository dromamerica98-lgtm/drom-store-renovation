import { describe, expect, it } from 'vitest';
import { addDays, computeProject, computeZoneView, zoneBreakdown } from './calc';
import { areaDisplayNames, normalizeAreaName } from './labels';
import { parseShekels } from './money';
import type { ChangeOrder, Dataset, Expense, Payment, Quote, Settings, WorkArea } from './types';
import { toBasis } from './vat';

const TODAY = '2026-11-07';
const audit = { createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' };
const ils = (shekels: number) => shekels * 100;

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    projectName: 'בדיקה',
    totalBudget: ils(500_000),
    budgetVat: 'excl',
    reserveAmount: ils(50_000),
    vatRate: 18,
    displayBasis: 'excl',
    updatedAt: '',
    updatedBy: '',
    ...overrides,
  };
}

function area(id: string, overrides: Partial<WorkArea> = {}): WorkArea {
  return {
    ...audit,
    id,
    name: id,
    zone: 'store',
    status: 'not_started',
    progress: 0,
    estimateAmount: null,
    estimateVat: 'excl',
    selectedQuoteId: null,
    notes: null,
    sortOrder: 0,
    ...overrides,
  };
}

function quote(id: string, workAreaId: string, shekels: number, overrides: Partial<Quote> = {}): Quote {
  return {
    ...audit,
    id,
    workAreaId,
    supplierId: 's1',
    amount: ils(shekels),
    vatMode: 'excl',
    receivedDate: null,
    validUntil: null,
    description: null,
    status: 'open',
    ...overrides,
  };
}

function change(workAreaId: string, shekels: number, status: ChangeOrder['status']): ChangeOrder {
  return {
    ...audit,
    id: `c-${workAreaId}-${shekels}-${status}`,
    workAreaId,
    description: 'תוספת',
    amount: ils(shekels),
    vatMode: 'excl',
    date: null,
    status,
  };
}

function payment(target: { workAreaId?: string; expenseId?: string }, shekels: number, overrides: Partial<Payment> = {}): Payment {
  return {
    ...audit,
    id: `p-${Math.random()}`,
    workAreaId: target.workAreaId ?? null,
    expenseId: target.expenseId ?? null,
    amount: ils(shekels),
    vatMode: 'excl',
    date: '2026-10-01',
    status: 'paid',
    method: null,
    reference: null,
    notes: null,
    ...overrides,
  };
}

function expense(id: string, overrides: Partial<Expense> = {}): Expense {
  return {
    ...audit,
    id,
    category: 'fee',
    description: id,
    payee: null,
    estimateAmount: null,
    estimateVat: 'exempt',
    actualAmount: null,
    actualVat: 'exempt',
    notes: null,
    ...overrides,
  };
}

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    settings: settings(),
    suppliers: [{ ...audit, id: 's1', name: 'ספק א', contactName: null, phone: null, email: null, taxId: null, notes: null }],
    workAreas: [],
    quotes: [],
    quoteFiles: [],
    changeOrders: [],
    expenses: [],
    payments: [],
    user: { email: 'test@example.com', logoutUrl: null, isAdmin: false },
    ...overrides,
  };
}

/** A single work area with a manual estimate, used to set the project forecast. */
function withForecast(shekels: number, extra: Partial<Dataset> = {}): Dataset {
  return dataset({ workAreas: [area('a', { estimateAmount: ils(shekels) })], ...extra });
}

describe('toBasis', () => {
  it('converts between incl and excl and leaves exempt amounts alone', () => {
    expect(toBasis(ils(118), 'incl', 'excl', 18)).toBe(ils(100));
    expect(toBasis(ils(100), 'excl', 'incl', 18)).toBe(ils(118));
    expect(toBasis(ils(100), 'incl', 'incl', 18)).toBe(ils(100));
    expect(toBasis(ils(100), 'excl', 'excl', 18)).toBe(ils(100));
    expect(toBasis(ils(100), 'exempt', 'excl', 18)).toBe(ils(100));
    expect(toBasis(ils(100), 'exempt', 'incl', 18)).toBe(ils(100));
  });

  it('rounds to whole agorot', () => {
    expect(toBasis(100, 'incl', 'excl', 18)).toBe(85);
  });
});

describe('parseShekels', () => {
  it('parses user input into agorot', () => {
    expect(parseShekels('1,234.50')).toBe(123_450);
    expect(parseShekels('₪ 500')).toBe(50_000);
    expect(parseShekels('-250')).toBe(-25_000);
    expect(parseShekels('')).toBeNull();
    expect(parseShekels('abc')).toBeNull();
    expect(parseShekels('1.234')).toBeNull();
  });
});

describe('work area forecast', () => {
  it('uses the selected quote plus approved changes only', () => {
    const s = computeProject(
      dataset({
        workAreas: [area('a', { selectedQuoteId: 'q2', estimateAmount: ils(1) })],
        quotes: [quote('q1', 'a', 80_000), quote('q2', 'a', 100_000)],
        changeOrders: [change('a', 5_000, 'approved'), change('a', -1_000, 'approved'), change('a', 7_000, 'pending')],
      }),
      TODAY,
    );
    const a = s.areas[0];
    expect(a.forecastSource).toBe('selected');
    expect(a.committed).toBe(ils(104_000));
    expect(a.forecast).toBe(ils(104_000));
    expect(a.pendingChanges).toBe(ils(7_000));
  });

  it('falls back to the manual estimate, then the cheapest open quote, then missing', () => {
    const s = computeProject(
      dataset({
        workAreas: [area('est', { estimateAmount: ils(60_000) }), area('low'), area('none')],
        quotes: [
          quote('q1', 'est', 50_000),
          quote('q2', 'low', 90_000),
          quote('q3', 'low', 70_000),
          quote('q4', 'low', 10_000, { status: 'rejected' }),
        ],
      }),
      TODAY,
    );
    const byId = Object.fromEntries(s.areas.map((a) => [a.area.id, a]));
    expect(byId.est.forecastSource).toBe('estimate');
    expect(byId.est.forecast).toBe(ils(60_000));
    expect(byId.est.committed).toBe(0);
    expect(byId.low.forecastSource).toBe('lowest_quote');
    expect(byId.low.forecast).toBe(ils(70_000));
    expect(byId.none.forecastSource).toBe('missing');
    expect(byId.none.forecast).toBe(0);
    expect(s.alerts.some((al) => al.code === 'area_missing_estimate' && al.link === '/areas/none')).toBe(true);
  });

  it('compares quotes with different VAT markings on the same basis', () => {
    const s = computeProject(
      dataset({
        workAreas: [area('a')],
        quotes: [quote('q1', 'a', 118_000, { vatMode: 'incl' }), quote('q2', 'a', 105_000)],
      }),
      TODAY,
    );
    expect(s.areas[0].lowestQuote).toBe(ils(100_000));
  });
});

describe('reserve', () => {
  it('stays intact while the forecast is within the work budget', () => {
    const s = computeProject(withForecast(400_000), TODAY);
    expect(s.workBudget).toBe(ils(450_000));
    expect(s.reserveUsed).toBe(0);
    expect(s.reserveRemaining).toBe(ils(50_000));
    expect(s.variance).toBe(ils(100_000));
    expect(s.alerts.find((a) => a.code.startsWith('reserve'))).toBeUndefined();
  });

  it('is reduced when the forecast reaches into it (spec example: 470,000)', () => {
    const s = computeProject(withForecast(470_000), TODAY);
    expect(s.reserveUsed).toBe(ils(20_000));
    expect(s.reserveRemaining).toBe(ils(30_000));
    expect(s.overrun).toBe(0);
    expect(s.variance).toBe(ils(30_000));
    expect(s.alerts[0].code).toBe('reserve_in_use');
  });

  it('warns once half of it is used', () => {
    const s = computeProject(withForecast(480_000), TODAY);
    expect(s.reserveUsedPct).toBe(60);
    expect(s.alerts[0].code).toBe('reserve_half_used');
  });

  it('is exhausted and the rest is an overrun (spec example: 520,000)', () => {
    const s = computeProject(withForecast(520_000), TODAY);
    expect(s.reserveUsed).toBe(ils(50_000));
    expect(s.reserveRemaining).toBe(0);
    expect(s.overrun).toBe(ils(20_000));
    expect(s.variance).toBe(ils(-20_000));
    expect(s.variancePct).toBe(-4);
    expect(s.alerts[0]).toMatchObject({ level: 'danger', code: 'budget_overrun' });
  });

  it('cannot exceed the total budget', () => {
    const s = computeProject(withForecast(0, { settings: settings({ reserveAmount: ils(900_000) }) }), TODAY);
    expect(s.reserve).toBe(ils(500_000));
    expect(s.workBudget).toBe(0);
  });
});

describe('display basis', () => {
  it('converts the budget and every amount to the chosen basis', () => {
    const data = dataset({
      settings: settings({ totalBudget: ils(590_000), budgetVat: 'incl', reserveAmount: ils(59_000), displayBasis: 'excl' }),
      workAreas: [area('a', { selectedQuoteId: 'q' })],
      quotes: [quote('q', 'a', 236_000, { vatMode: 'incl' })],
      expenses: [expense('fee', { actualAmount: ils(10_000), actualVat: 'exempt' })],
      payments: [payment({ workAreaId: 'a' }, 118_000, { vatMode: 'incl' })],
    });
    const excl = computeProject(data, TODAY);
    expect(excl.budget).toBe(ils(500_000));
    expect(excl.reserve).toBe(ils(50_000));
    expect(excl.forecast).toBe(ils(210_000));
    expect(excl.paid).toBe(ils(100_000));

    const incl = computeProject({ ...data, settings: { ...data.settings, displayBasis: 'incl' } }, TODAY);
    expect(incl.budget).toBe(ils(590_000));
    expect(incl.forecast).toBe(ils(246_000));
    expect(incl.paid).toBe(ils(118_000));
  });
});

describe('paid and remaining', () => {
  it('sums the remaining per item so an overpayment does not hide another balance', () => {
    const s = computeProject(
      dataset({
        workAreas: [area('a', { selectedQuoteId: 'qa' }), area('b', { estimateAmount: ils(30_000) })],
        quotes: [quote('qa', 'a', 10_000)],
        payments: [
          payment({ workAreaId: 'a' }, 15_000),
          payment({ workAreaId: 'b' }, 5_000),
          payment({ workAreaId: 'b' }, 8_000, { status: 'planned', date: '2026-11-20' }),
        ],
      }),
      TODAY,
    );
    expect(s.forecast).toBe(ils(40_000));
    expect(s.paid).toBe(ils(20_000));
    expect(s.planned).toBe(ils(8_000));
    expect(s.remaining).toBe(ils(25_000));
    expect(s.remainingCommitted).toBe(0);
    expect(s.remainingUncommitted).toBe(ils(25_000));
    expect(s.areas[0].overpaid).toBe(ils(5_000));
    expect(s.alerts.some((a) => a.code === 'area_overpaid')).toBe(true);
  });

  it('treats an expense with an actual amount as committed and an estimate as not yet closed', () => {
    const s = computeProject(
      dataset({
        expenses: [
          expense('ins', { actualAmount: ils(12_000), estimateAmount: ils(9_000) }),
          expense('permit', { estimateAmount: ils(4_000) }),
        ],
        payments: [payment({ expenseId: 'ins' }, 2_000)],
      }),
      TODAY,
    );
    expect(s.expenses[0]).toMatchObject({ forecastSource: 'actual', forecast: ils(12_000), remainingCommitted: ils(10_000) });
    expect(s.expenses[1]).toMatchObject({ forecastSource: 'estimate', remainingUncommitted: ils(4_000) });
    expect(s.remaining).toBe(ils(14_000));
  });
});

describe('progress and alerts', () => {
  it('weights the overall progress by forecast', () => {
    const s = computeProject(
      dataset({
        workAreas: [
          area('big', { estimateAmount: ils(90_000), progress: 100 }),
          area('small', { estimateAmount: ils(10_000), progress: 0 }),
        ],
      }),
      TODAY,
    );
    expect(s.progress).toBe(90);
  });

  it('flags paying ahead of the work', () => {
    const s = computeProject(
      dataset({
        workAreas: [area('a', { selectedQuoteId: 'q', progress: 20 })],
        quotes: [quote('q', 'a', 100_000)],
        payments: [payment({ workAreaId: 'a' }, 40_000)],
      }),
      TODAY,
    );
    expect(s.alerts.some((a) => a.code === 'area_paid_ahead')).toBe(true);
  });

  it('flags overdue planned payments and lists upcoming ones', () => {
    const s = computeProject(
      dataset({
        workAreas: [area('a', { estimateAmount: ils(100_000) })],
        payments: [
          payment({ workAreaId: 'a' }, 1_000, { status: 'planned', date: '2026-11-01' }),
          payment({ workAreaId: 'a' }, 2_000, { status: 'planned', date: '2026-11-30' }),
          payment({ workAreaId: 'a' }, 3_000, { status: 'planned', date: '2027-03-01' }),
        ],
      }),
      TODAY,
    );
    expect(s.upcomingPayments.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-30']);
    expect(s.alerts.some((a) => a.code === 'payments_overdue')).toBe(true);
  });

  it('flags open quotes that are about to expire only while no quote is selected', () => {
    const quotes = [quote('q1', 'a', 50_000, { validUntil: addDays(TODAY, 5) })];
    const open = computeProject(dataset({ workAreas: [area('a')], quotes }), TODAY);
    expect(open.alerts.some((a) => a.code === 'quote_expiring')).toBe(true);

    const selected = computeProject(dataset({ workAreas: [area('a', { selectedQuoteId: 'q1' })], quotes }), TODAY);
    expect(selected.alerts.some((a) => a.code === 'quote_expiring')).toBe(false);
  });
});

describe('zones', () => {
  const zoned = () =>
    dataset({
      workAreas: [
        area('elec-store', { name: 'חשמל', zone: 'store', estimateAmount: ils(80_000), progress: 50 }),
        area('elec-office', { name: 'חשמל', zone: 'office_warehouse', estimateAmount: ils(20_000), progress: 100 }),
        area('hvac-office', { name: 'מיזוג', zone: 'office_warehouse', selectedQuoteId: 'q', progress: 0 }),
        area('cladding', { name: 'סגירת חוץ', zone: 'exterior', estimateAmount: ils(50_000) }),
      ],
      quotes: [quote('q', 'hvac-office', 30_000)],
      expenses: [expense('permit', { actualAmount: ils(10_000) })],
      payments: [
        payment({ workAreaId: 'elec-store' }, 30_000),
        payment({ workAreaId: 'hvac-office' }, 40_000),
        payment({ workAreaId: 'elec-office' }, 5_000, { status: 'planned', date: '2026-11-01' }),
        payment({ expenseId: 'permit' }, 10_000),
      ],
    });

  it('splits the project by zone, keeping general expenses separate', () => {
    const s = computeProject(zoned(), TODAY);
    const b = zoneBreakdown(s);
    const byZone = Object.fromEntries(b.zones.map((z) => [z.zone, z]));
    expect(b.zones.map((z) => z.zone)).toEqual(['store', 'office_warehouse', 'exterior']);
    expect(byZone.store).toMatchObject({ forecast: ils(80_000), paid: ils(30_000), remaining: ils(50_000), areaCount: 1, progress: 50 });
    expect(byZone.office_warehouse).toMatchObject({ forecast: ils(50_000), paid: ils(40_000), planned: ils(5_000), areaCount: 2 });
    expect(byZone.office_warehouse.progress).toBe(40);
    expect(byZone.exterior).toMatchObject({ forecast: ils(50_000), paid: 0, areaCount: 1 });
    expect(b.general).toMatchObject({ forecast: ils(10_000), paid: ils(10_000), count: 1 });
    // The zones plus general expenses add up to the whole project.
    expect(b.zones.reduce((t, z) => t + z.forecast, 0) + b.general.forecast).toBe(s.forecast);
    expect(b.zones.reduce((t, z) => t + z.paid, 0) + b.general.paid).toBe(s.paid);
    expect(byZone.store.shareOfProject).toBeCloseTo((80_000 / 190_000) * 100);
  });

  it('filters the dashboard numbers, payments and alerts to one zone', () => {
    const data = zoned();
    const s = computeProject(data, TODAY);
    const office = computeZoneView(s, data, 'office_warehouse', TODAY);
    expect(office.areas.map((a) => a.area.id)).toEqual(['elec-office', 'hvac-office']);
    expect(office).toMatchObject({ forecast: ils(50_000), paid: ils(40_000), remaining: ils(20_000) });
    expect(office.remaining).toBe(office.remainingCommitted + office.remainingUncommitted);
    expect(office.upcomingPayments.map((p) => p.workAreaId)).toEqual(['elec-office']);
    // hvac-office: 40,000 paid of 30,000 forecast -> overpaid alert; plus this zone's overdue payment.
    expect(office.alerts.map((a) => a.code).sort()).toEqual(['area_overpaid', 'payments_overdue']);
    expect(office.alerts.every((a) => a.code === 'payments_overdue' || a.areaId === 'hvac-office')).toBe(true);

    const store = computeZoneView(s, data, 'store', TODAY);
    expect(store.upcomingPayments).toEqual([]);
    expect(store.alerts.some((a) => a.code === 'payments_overdue')).toBe(false);
  });

  it('adds the zone to an area name only when the name exists in more than one zone', () => {
    const names = areaDisplayNames(zoned().workAreas);
    expect(names.get('elec-store')).toBe('חשמל · חנות');
    expect(names.get('elec-office')).toBe('חשמל · משרד מחסן');
    expect(names.get('hvac-office')).toBe('מיזוג');
    expect(normalizeAreaName('  כיבוי  אש ')).toBe('כיבוי אש');
  });

  it('names duplicated areas with their zone in alerts', () => {
    const s = computeProject(
      dataset({ workAreas: [area('a', { name: 'חשמל', zone: 'store' }), area('b', { name: 'חשמל', zone: 'exterior' })] }),
      TODAY,
    );
    expect(s.alerts.filter((a) => a.code === 'area_missing_estimate').map((a) => a.message.split(':')[0]).sort()).toEqual([
      'חשמל · חנות',
      'חשמל · סגירת חוץ',
    ]);
  });
});
