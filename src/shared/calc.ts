import { areaDisplayNames, ZONE_ORDER } from './labels';
import { formatILS } from './money';
import type { ChangeOrder, Dataset, Expense, Payment, Quote, VatMode, WorkArea, Zone } from './types';
import { toBasis } from './vat';

/** Paying more than this many percentage points ahead of the progress raises an alert. */
export const PAID_AHEAD_THRESHOLD_PCT = 10;
/** Open quotes expiring within this many days raise an alert. */
export const QUOTE_EXPIRY_WARNING_DAYS = 14;
/** Planned payments within this many days show as upcoming. */
export const UPCOMING_PAYMENT_DAYS = 30;

export type AreaForecastSource = 'selected' | 'estimate' | 'lowest_quote' | 'missing';
export type ExpenseForecastSource = 'actual' | 'estimate' | 'missing';

/** Every amount below is in agorot on the project's display basis. */
export interface AreaCalc {
  area: WorkArea;
  selectedQuote: Quote | null;
  /** Normalized amount of the cheapest open quote, if any. */
  lowestQuote: number | null;
  approvedChanges: number;
  pendingChanges: number;
  committed: number;
  forecast: number;
  forecastSource: AreaForecastSource;
  paid: number;
  planned: number;
  remaining: number;
  overpaid: number;
  remainingCommitted: number;
  remainingUncommitted: number;
  /** paid / forecast in percent; null when there is no forecast. */
  paidPct: number | null;
}

export interface ExpenseCalc {
  expense: Expense;
  forecast: number;
  forecastSource: ExpenseForecastSource;
  committed: number;
  paid: number;
  planned: number;
  remaining: number;
  overpaid: number;
  remainingCommitted: number;
  remainingUncommitted: number;
}

export type AlertLevel = 'danger' | 'warning' | 'info';

export interface Alert {
  level: AlertLevel;
  code: string;
  message: string;
  /** In-app path the alert refers to. */
  link?: string;
  /** The work area the alert is about, if any (used to filter alerts by zone). */
  areaId?: string;
}

export interface ProjectSummary {
  budget: number;
  reserve: number;
  workBudget: number;
  forecast: number;
  forecastAreas: number;
  forecastExpenses: number;
  committed: number;
  paid: number;
  planned: number;
  remaining: number;
  remainingCommitted: number;
  remainingUncommitted: number;
  reserveUsed: number;
  reserveRemaining: number;
  /** Share of the reserve already used, 0–100. */
  reserveUsedPct: number;
  /** budget − forecast. Positive: expected to remain. Negative: overrun. */
  variance: number;
  /** variance / budget in percent; 0 when there is no budget. */
  variancePct: number;
  overrun: number;
  /** Progress of all work areas weighted by forecast, 0–100. */
  progress: number;
  areas: AreaCalc[];
  expenses: ExpenseCalc[];
  /** Planned payments that are overdue or due within UPCOMING_PAYMENT_DAYS, by date. */
  upcomingPayments: Payment[];
  alerts: Alert[];
}

const ALERT_ORDER: Record<AlertLevel, number> = { danger: 0, warning: 1, info: 2 };

/** Adds days to an ISO date (YYYY-MM-DD). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeProject(data: Dataset, today: string): ProjectSummary {
  const { settings } = data;
  const basis = settings.displayBasis;
  const norm = (amount: number, mode: VatMode) => toBasis(amount, mode, basis, settings.vatRate);

  const quotesByArea = groupBy(data.quotes, (q) => q.workAreaId);
  const changesByArea = groupBy(data.changeOrders, (c) => c.workAreaId);
  const paymentsByArea = groupBy(
    data.payments.filter((p) => p.workAreaId),
    (p) => p.workAreaId as string,
  );
  const paymentsByExpense = groupBy(
    data.payments.filter((p) => p.expenseId),
    (p) => p.expenseId as string,
  );
  const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));

  const paidAndPlanned = (payments: Payment[]) => ({
    paid: sum(payments.filter((p) => p.status === 'paid').map((p) => norm(p.amount, p.vatMode))),
    planned: sum(payments.filter((p) => p.status === 'planned').map((p) => norm(p.amount, p.vatMode))),
  });

  const areas: AreaCalc[] = [...data.workAreas]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'he'))
    .map((area) => {
      const quotes = quotesByArea.get(area.id) ?? [];
      const changes: ChangeOrder[] = changesByArea.get(area.id) ?? [];
      const selectedQuote = quotes.find((q) => q.id === area.selectedQuoteId) ?? null;
      const openAmounts = quotes.filter((q) => q.status === 'open').map((q) => norm(q.amount, q.vatMode));
      const lowestQuote = openAmounts.length ? Math.min(...openAmounts) : null;
      const approvedChanges = sum(
        changes.filter((c) => c.status === 'approved').map((c) => norm(c.amount, c.vatMode)),
      );
      const pendingChanges = sum(
        changes.filter((c) => c.status === 'pending').map((c) => norm(c.amount, c.vatMode)),
      );

      const committed = selectedQuote ? norm(selectedQuote.amount, selectedQuote.vatMode) + approvedChanges : 0;
      let forecast: number;
      let forecastSource: AreaForecastSource;
      if (selectedQuote) {
        forecast = committed;
        forecastSource = 'selected';
      } else if (area.estimateAmount !== null) {
        forecast = norm(area.estimateAmount, area.estimateVat);
        forecastSource = 'estimate';
      } else if (lowestQuote !== null) {
        forecast = lowestQuote;
        forecastSource = 'lowest_quote';
      } else {
        forecast = 0;
        forecastSource = 'missing';
      }

      const { paid, planned } = paidAndPlanned(paymentsByArea.get(area.id) ?? []);
      const remaining = Math.max(forecast - paid, 0);
      return {
        area,
        selectedQuote,
        lowestQuote,
        approvedChanges,
        pendingChanges,
        committed,
        forecast,
        forecastSource,
        paid,
        planned,
        remaining,
        overpaid: Math.max(paid - forecast, 0),
        remainingCommitted: selectedQuote ? remaining : 0,
        remainingUncommitted: selectedQuote ? 0 : remaining,
        paidPct: forecast > 0 ? (paid / forecast) * 100 : null,
      };
    });

  const expenses: ExpenseCalc[] = data.expenses.map((expense) => {
    let forecast: number;
    let forecastSource: ExpenseForecastSource;
    if (expense.actualAmount !== null) {
      forecast = norm(expense.actualAmount, expense.actualVat);
      forecastSource = 'actual';
    } else if (expense.estimateAmount !== null) {
      forecast = norm(expense.estimateAmount, expense.estimateVat);
      forecastSource = 'estimate';
    } else {
      forecast = 0;
      forecastSource = 'missing';
    }
    const { paid, planned } = paidAndPlanned(paymentsByExpense.get(expense.id) ?? []);
    const remaining = Math.max(forecast - paid, 0);
    const isCommitted = forecastSource === 'actual';
    return {
      expense,
      forecast,
      forecastSource,
      committed: isCommitted ? forecast : 0,
      paid,
      planned,
      remaining,
      overpaid: Math.max(paid - forecast, 0),
      remainingCommitted: isCommitted ? remaining : 0,
      remainingUncommitted: isCommitted ? 0 : remaining,
    };
  });

  const items = [...areas, ...expenses];
  const budget = Math.max(norm(settings.totalBudget, settings.budgetVat), 0);
  const reserve = clamp(norm(settings.reserveAmount, settings.budgetVat), 0, budget);
  const workBudget = budget - reserve;
  const forecastAreas = sum(areas.map((a) => a.forecast));
  const forecastExpenses = sum(expenses.map((e) => e.forecast));
  const forecast = forecastAreas + forecastExpenses;
  const reserveUsed = clamp(forecast - workBudget, 0, reserve);
  const variance = budget - forecast;

  const progress = weightedProgress(areas);

  const upcomingLimit = addDays(today, UPCOMING_PAYMENT_DAYS);
  const upcomingPayments = data.payments
    .filter((p) => p.status === 'planned' && p.date <= upcomingLimit)
    .sort((a, b) => a.date.localeCompare(b.date));

  const summary: ProjectSummary = {
    budget,
    reserve,
    workBudget,
    forecast,
    forecastAreas,
    forecastExpenses,
    committed: sum(items.map((i) => i.committed)),
    paid: sum(items.map((i) => i.paid)),
    planned: sum(items.map((i) => i.planned)),
    remaining: sum(items.map((i) => i.remaining)),
    remainingCommitted: sum(items.map((i) => i.remainingCommitted)),
    remainingUncommitted: sum(items.map((i) => i.remainingUncommitted)),
    reserveUsed,
    reserveRemaining: reserve - reserveUsed,
    reserveUsedPct: reserve > 0 ? (reserveUsed / reserve) * 100 : 0,
    variance,
    variancePct: budget > 0 ? (variance / budget) * 100 : 0,
    overrun: Math.max(forecast - budget, 0),
    progress,
    areas,
    expenses,
    upcomingPayments,
    alerts: [],
  };
  summary.alerts = buildAlerts(summary, data, today, supplierName);
  return summary;
}

function buildAlerts(
  s: ProjectSummary,
  data: Dataset,
  today: string,
  supplierName: Map<string, string>,
): Alert[] {
  const alerts: Alert[] = [];

  if (s.forecast > s.budget) {
    alerts.push({
      level: 'danger',
      code: 'budget_overrun',
      message: `צפויה חריגה של ${formatILS(s.overrun)} מהתקציב. הרזרבה נוצלה במלואה.`,
    });
  } else if (s.reserve > 0 && s.reserveUsedPct >= 50) {
    alerts.push({
      level: 'warning',
      code: 'reserve_half_used',
      message: `נוצלו ${Math.round(s.reserveUsedPct)}% מהרזרבה. נותרו ${formatILS(s.reserveRemaining)}.`,
      link: '/settings',
    });
  } else if (s.reserveUsed > 0) {
    alerts.push({
      level: 'info',
      code: 'reserve_in_use',
      message: `התחלתם לנצל את הרזרבה: נוצלו ${formatILS(s.reserveUsed)}.`,
      link: '/settings',
    });
  }

  const displayNames = areaDisplayNames(data.workAreas);
  for (const a of s.areas) {
    const link = `/areas/${a.area.id}`;
    const name = displayNames.get(a.area.id) ?? a.area.name;
    const add = (alert: Alert) => alerts.push({ ...alert, areaId: a.area.id });
    if (a.overpaid > 0) {
      add({
        level: 'danger',
        code: 'area_overpaid',
        message: `${name}: שולם ${formatILS(a.overpaid)} יותר מהתחזית.`,
        link,
      });
    } else if (a.paidPct !== null && a.paid > 0 && a.paidPct - a.area.progress > PAID_AHEAD_THRESHOLD_PCT) {
      add({
        level: 'warning',
        code: 'area_paid_ahead',
        message: `${name}: שולמו ${Math.round(a.paidPct)}% מהעלות, אבל ההתקדמות היא ${a.area.progress}%.`,
        link,
      });
    }
    if (a.forecastSource === 'missing') {
      add({
        level: 'warning',
        code: 'area_missing_estimate',
        message: `${name}: אין הצעה נבחרת, הערכה או הצעת מחיר, ולכן התחום לא נספר בתחזית.`,
        link,
      });
    }
    if (a.pendingChanges !== 0) {
      add({
        level: 'info',
        code: 'area_pending_changes',
        message: `${name}: תוספות בסך ${formatILS(a.pendingChanges)} ממתינות לאישור ואינן בתחזית.`,
        link,
      });
    }
    if (!a.selectedQuote) {
      const expiryLimit = addDays(today, QUOTE_EXPIRY_WARNING_DAYS);
      for (const q of data.quotes) {
        if (q.workAreaId !== a.area.id || q.status !== 'open' || !q.validUntil) continue;
        const supplier = supplierName.get(q.supplierId) ?? 'ספק';
        if (q.validUntil < today) {
          add({
            level: 'info',
            code: 'quote_expired',
            message: `${name}: תוקף ההצעה של ${supplier} פג ב־${formatDate(q.validUntil)}.`,
            link,
          });
        } else if (q.validUntil <= expiryLimit) {
          add({
            level: 'warning',
            code: 'quote_expiring',
            message: `${name}: ההצעה של ${supplier} בתוקף רק עד ${formatDate(q.validUntil)}.`,
            link,
          });
        }
      }
    }
  }

  for (const e of s.expenses) {
    const link = `/expenses/${e.expense.id}`;
    if (e.overpaid > 0) {
      alerts.push({
        level: 'danger',
        code: 'expense_overpaid',
        message: `${e.expense.description}: שולם ${formatILS(e.overpaid)} יותר מהתחזית.`,
        link,
      });
    }
    if (e.forecastSource === 'missing') {
      alerts.push({
        level: 'warning',
        code: 'expense_missing_estimate',
        message: `${e.expense.description}: חסר סכום או הערכה, ולכן ההוצאה לא נספרת בתחזית.`,
        link,
      });
    }
  }

  const overdue = overdueAlert(data.payments, today);
  if (overdue) alerts.push(overdue);

  return sortAlerts(alerts);
}

function sortAlerts(alerts: Alert[]): Alert[] {
  return alerts.sort((a, b) => ALERT_ORDER[a.level] - ALERT_ORDER[b.level]);
}

function overdueAlert(payments: Payment[], today: string): Alert | null {
  const overdue = payments.filter((p) => p.status === 'planned' && p.date < today);
  if (!overdue.length) return null;
  return {
    level: 'warning',
    code: 'payments_overdue',
    message: overdue.length === 1 ? `תשלום מתוכנן אחד עבר את מועדו.` : `${overdue.length} תשלומים מתוכננים עברו את מועדם.`,
    link: '/payments',
  };
}

/** Progress of work areas, weighted by their forecast (simple average when nothing is forecast). */
function weightedProgress(areas: AreaCalc[]): number {
  if (!areas.length) return 0;
  const total = sum(areas.map((a) => a.forecast));
  return total > 0
    ? sum(areas.map((a) => a.area.progress * a.forecast)) / total
    : sum(areas.map((a) => a.area.progress)) / areas.length;
}

// ---------- Zones ----------

/** Money totals of a group of items (all in agorot on the display basis). */
export interface Totals {
  forecast: number;
  committed: number;
  paid: number;
  planned: number;
  remaining: number;
  remainingCommitted: number;
  remainingUncommitted: number;
}

function totalsOf(items: (AreaCalc | ExpenseCalc)[]): Totals {
  return {
    forecast: sum(items.map((i) => i.forecast)),
    committed: sum(items.map((i) => i.committed)),
    paid: sum(items.map((i) => i.paid)),
    planned: sum(items.map((i) => i.planned)),
    remaining: sum(items.map((i) => i.remaining)),
    remainingCommitted: sum(items.map((i) => i.remainingCommitted)),
    remainingUncommitted: sum(items.map((i) => i.remainingUncommitted)),
  };
}

export interface ZoneTotals extends Totals {
  zone: Zone;
  areaCount: number;
  /** Weighted progress of the zone's work areas, 0–100. */
  progress: number;
  /** The zone's share of the whole project's forecast, 0–100. */
  shareOfProject: number;
}

export interface ZoneBreakdown {
  zones: ZoneTotals[];
  /** General expenses (fees, insurance…) belong to the whole project, not to a zone. */
  general: Totals & { count: number; shareOfProject: number };
}

/** The project's money and progress split by zone, plus the project-wide general expenses. */
export function zoneBreakdown(s: ProjectSummary): ZoneBreakdown {
  const share = (forecast: number) => (s.forecast > 0 ? (forecast / s.forecast) * 100 : 0);
  const zones = ZONE_ORDER.map((zone) => {
    const areas = s.areas.filter((a) => a.area.zone === zone);
    const totals = totalsOf(areas);
    return { zone, ...totals, areaCount: areas.length, progress: weightedProgress(areas), shareOfProject: share(totals.forecast) };
  });
  const general = totalsOf(s.expenses);
  return { zones, general: { ...general, count: s.expenses.length, shareOfProject: share(general.forecast) } };
}

export interface ZoneView extends ZoneTotals {
  areas: AreaCalc[];
  upcomingPayments: Payment[];
  alerts: Alert[];
}

/** Everything the dashboard shows when filtered to one zone. Budget and reserve stay project-wide. */
export function computeZoneView(s: ProjectSummary, data: Dataset, zone: Zone, today: string): ZoneView {
  const areas = s.areas.filter((a) => a.area.zone === zone);
  const ids = new Set(areas.map((a) => a.area.id));
  const totals = totalsOf(areas);
  const inZone = (p: Payment) => p.workAreaId !== null && ids.has(p.workAreaId);
  const alerts = s.alerts.filter((a) => a.areaId !== undefined && ids.has(a.areaId));
  const overdue = overdueAlert(data.payments.filter(inZone), today);
  if (overdue) alerts.push(overdue);
  return {
    zone,
    ...totals,
    areaCount: areas.length,
    progress: weightedProgress(areas),
    shareOfProject: s.forecast > 0 ? (totals.forecast / s.forecast) * 100 : 0,
    areas,
    upcomingPayments: s.upcomingPayments.filter(inZone),
    alerts: sortAlerts(alerts),
  };
}

/** Formats an ISO date (YYYY-MM-DD) as DD/MM/YYYY. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
