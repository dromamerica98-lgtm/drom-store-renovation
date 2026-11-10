import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  computeZoneView,
  formatDate,
  zoneBreakdown,
  type Alert,
  type AreaCalc,
  type ProjectSummary,
  type Totals,
  type ZoneView,
} from '../../shared/calc';
import { AREA_FORECAST_SOURCE_LABELS, AREA_STATUS_LABELS, VAT_BASIS_LABELS, ZONE_LABELS } from '../../shared/labels';
import { formatILS, formatNumber, formatPct } from '../../shared/money';
import type { Payment, Zone } from '../../shared/types';
import { toBasis } from '../../shared/vat';
import { Chip, Empty, Icon, Meter, Money, PageHeader, Section, type IconName } from '../components/ui';
import { useZoneFilter, ZoneFilter, type ZoneChoice } from '../components/ZoneFilter';
import { todayISO, useData } from '../data';
import { areaName, paymentTargetLink, paymentTargetName } from '../util';
import { InstallBanner } from './Install';

export function Dashboard() {
  const { data, summary: s } = useData();
  const [zone, setZone] = useZoneFilter();
  const view = useMemo(() => (zone === 'all' ? null : computeZoneView(s, data, zone, todayISO())), [s, data, zone]);
  const basis = `כל הסכומים ${VAT_BASIS_LABELS[data.settings.displayBasis]}`;
  return (
    <>
      <PageHeader title={data.settings.projectName} subtitle={view ? `${ZONE_LABELS[view.zone]} · ${basis}` : basis} />
      <InstallBanner />
      <ZoneFilter value={zone} onChange={setZone} />
      {view ? <ZoneDashboard v={view} onAll={() => setZone('all')} /> : <ProjectDashboard s={s} onZone={setZone} />}
    </>
  );
}

// ---------- The whole project ----------

function ProjectDashboard({ s, onZone }: { s: ProjectSummary; onZone: (z: ZoneChoice) => void }) {
  return (
    <>
      <Hero s={s} />
      <div className="kpis">
        <Stat
          label="תקציב כולל"
          value={s.budget}
          sub={s.reserve ? `מתוכו רזרבה ${formatILS(s.reserve)}` : 'לא הוגדרה רזרבה'}
        />
        <Stat
          label="תחזית עלות"
          value={s.forecast}
          sub={s.budget ? `${formatPct((s.forecast / s.budget) * 100)} מהתקציב` : undefined}
        />
        <Stat
          label="שולם"
          value={s.paid}
          sub={s.forecast ? `${formatPct((s.paid / s.forecast) * 100)} מהתחזית` : undefined}
        />
        <Stat
          label="נותר לתשלום"
          value={s.remaining}
          sub={`מחויב ${formatILS(s.remainingCommitted)}\nטרם נסגר ${formatILS(s.remainingUncommitted)}`}
        />
        <Stat
          label="רזרבה שנותרה"
          value={s.reserveRemaining}
          wide
          sub={
            !s.reserve
              ? 'לא הוגדרה רזרבה'
              : s.reserveUsed
                ? `נוצלו ${formatILS(s.reserveUsed)} מתוך ${formatILS(s.reserve)}`
                : 'עדיין לא נוצלה'
          }
        >
          {s.reserve > 0 && (
            <Meter
              value={s.reserveUsedPct}
              label="ניצול הרזרבה"
              tone={s.reserveUsedPct >= 100 ? 'critical' : s.reserveUsedPct >= 50 ? 'warning' : undefined}
            />
          )}
        </Stat>
      </div>
      <ZonesSection s={s} onZone={onZone} />
      <BudgetBar s={s} />
      <ProgressSection title="התקדמות כוללת" value={s.progress} />
      <Alerts alerts={s.alerts} />
      <UpcomingPayments payments={s.upcomingPayments} />
      <AreasTable areas={s.areas} totals={s} general={totalsOfExpenses(s)} />
    </>
  );
}

function Hero({ s }: { s: ProjectSummary }) {
  const ok = s.variance >= 0;
  return (
    <section className={`card hero ${ok ? 'is-good' : 'is-critical'}`}>
      <div className="hero-label">
        <Icon name={ok ? 'check' : 'alert'} />
        {ok ? 'צפוי להישאר מהתקציב' : 'צפויה חריגה מהתקציב'}
      </div>
      <div className="hero-value">{formatILS(Math.abs(s.variance))}</div>
      <div className="hero-sub">
        {formatPct(Math.abs(s.variancePct))} מהתקציב
        {ok && s.reserveRemaining > 0 && `, כולל רזרבה של ${formatILS(s.reserveRemaining)} שלא נוצלה`}
      </div>
    </section>
  );
}

/**
 * The project's expected cost split by zone, with the project-wide general expenses as their own
 * part: a thin segmented bar (one hue per zone) and a table with the figures. Rows filter the page.
 */
function ZonesSection({ s, onZone }: { s: ProjectSummary; onZone: (z: ZoneChoice) => void }) {
  const b = zoneBreakdown(s);
  const parts = [
    ...b.zones.map((z) => ({ key: z.zone as Zone | 'general', label: ZONE_LABELS[z.zone], value: z.forecast })),
    { key: 'general' as const, label: 'הוצאות כלליות', value: b.general.forecast },
  ];
  const total = Math.max(s.forecast, 1);
  const label = parts.map((p) => `${p.label} ${formatILS(p.value)}`).join(', ');
  return (
    <Section title="הוצאה לפי אזור">
      <div className="zone-bar" role="img" aria-label={`תחזית העלות לפי אזור: ${label}`}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.key}
              className={`seg zone-${p.key}`}
              style={{ width: `${(p.value / total) * 100}%` }}
              title={`${p.label}: ${formatILS(p.value)} (${formatPct((p.value / total) * 100)})`}
            />
          ))}
      </div>
      <div className="table-wrap">
        <table className="table zone-table">
          <thead>
            <tr>
              <th>אזור</th>
              <th className="n">תחזית ₪</th>
              <th className="n">שולם ₪</th>
              <th className="n">נותר ₪</th>
              <th className="n col-progress">התקדמות</th>
            </tr>
          </thead>
          <tbody>
            {b.zones.map((z) => (
              <tr key={z.zone}>
                <td>
                  <button type="button" className="link-button cell-title" onClick={() => onZone(z.zone)}>
                    <i className={`zone-dot zone-${z.zone}`} aria-hidden="true" />
                    {ZONE_LABELS[z.zone]}
                  </button>
                  <span className="cell-sub">
                    {z.areaCount} תחומים · {formatPct(z.shareOfProject)} מהתחזית
                  </span>
                </td>
                <td className="n num">{formatNumber(z.forecast)}</td>
                <td className="n num">{formatNumber(z.paid)}</td>
                <td className="n num">{formatNumber(z.remaining)}</td>
                <td className="n num col-progress">{z.areaCount ? formatPct(z.progress) : '—'}</td>
              </tr>
            ))}
            <tr>
              <td>
                <Link to="/expenses" className="cell-title">
                  <i className="zone-dot zone-general" aria-hidden="true" />
                  הוצאות כלליות
                </Link>
                <span className="cell-sub">לכל הפרויקט · {b.general.count} פריטים</span>
              </td>
              <td className="n num">{formatNumber(b.general.forecast)}</td>
              <td className="n num">{formatNumber(b.general.paid)}</td>
              <td className="n num">{formatNumber(b.general.remaining)}</td>
              <td className="n col-progress" />
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>כל הפרויקט</td>
              <td className="n num">{formatNumber(s.forecast)}</td>
              <td className="n num">{formatNumber(s.paid)}</td>
              <td className="n num">{formatNumber(s.remaining)}</td>
              <td className="n num col-progress">{formatPct(s.progress)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="hint">הקישו על אזור כדי לראות רק אותו.</p>
    </Section>
  );
}

/**
 * Thin segmented bar: paid + remaining against the budget. The track is the unused budget;
 * two markers show where the reserve starts and where the total budget ends.
 */
function BudgetBar({ s }: { s: ProjectSummary }) {
  const used = s.paid + s.remaining;
  const scale = Math.max(s.budget, used, 1);
  const pct = (v: number) => `${(v / scale) * 100}%`;
  const free = Math.max(s.budget - used, 0);
  const label = `שולם ${formatILS(s.paid)}, נותר לתשלום ${formatILS(s.remaining)}, תקציב כולל ${formatILS(s.budget)}`;
  return (
    <Section title="תחזית מול תקציב">
      <div className="budget-bar" role="img" aria-label={label}>
        <div className="budget-track">
          {s.paid > 0 && <span className="seg seg-paid" style={{ width: pct(s.paid) }} title={`שולם: ${formatILS(s.paid)}`} />}
          {s.remaining > 0 && (
            <span className="seg seg-remaining" style={{ width: pct(s.remaining) }} title={`נותר לתשלום: ${formatILS(s.remaining)}`} />
          )}
        </div>
        {s.reserve > 0 && <span className="marker marker-reserve" style={{ insetInlineStart: pct(s.workBudget) }} />}
        <span className="marker marker-budget" style={{ insetInlineStart: pct(s.budget) }} />
      </div>
      <ul className="legend">
        <li>
          <i className="swatch seg-paid" />
          שולם <b className="num">{formatILS(s.paid)}</b>
        </li>
        <li>
          <i className="swatch seg-remaining" />
          נותר לתשלום <b className="num">{formatILS(s.remaining)}</b>
        </li>
        {free > 0 && (
          <li>
            <i className="swatch seg-free" />
            לא מנוצל <b className="num">{formatILS(free)}</b>
          </li>
        )}
        {s.reserve > 0 && (
          <li>
            <i className="swatch-line marker-reserve" />
            כאן מתחילה הרזרבה <b className="num">{formatILS(s.workBudget)}</b>
          </li>
        )}
        <li>
          <i className="swatch-line marker-budget" />
          תקציב כולל <b className="num">{formatILS(s.budget)}</b>
        </li>
      </ul>
    </Section>
  );
}

// ---------- One zone ----------

/** The dashboard filtered to one zone. Budget, reserve and general expenses stay project-wide. */
function ZoneDashboard({ v, onAll }: { v: ZoneView; onAll: () => void }) {
  const name = ZONE_LABELS[v.zone];
  return (
    <>
      <section className={`card hero zone-hero zone-border-${v.zone}`}>
        <div className="hero-label">
          <i className={`zone-dot zone-${v.zone}`} aria-hidden="true" />
          תחזית העלות ב{name}
        </div>
        <div className="hero-value">{formatILS(v.forecast)}</div>
        <div className="hero-sub">
          {formatPct(v.shareOfProject)} מתחזית כל הפרויקט · {v.areaCount} תחומים
        </div>
      </section>
      <div className="kpis">
        <Stat label="שולם" value={v.paid} sub={v.forecast ? `${formatPct((v.paid / v.forecast) * 100)} מהתחזית של האזור` : undefined} />
        <Stat
          label="נותר לתשלום"
          value={v.remaining}
          sub={`מחויב ${formatILS(v.remainingCommitted)}\nטרם נסגר ${formatILS(v.remainingUncommitted)}`}
        />
      </div>
      <PaidBar totals={v} title={`שולם ונותר ב${name}`} />
      <ProgressSection title={`התקדמות ב${name}`} value={v.progress} />
      <Alerts alerts={v.alerts} />
      <UpcomingPayments payments={v.upcomingPayments} />
      <AreasTable areas={v.areas} totals={v} zone={v.zone} />
      <section className="card zone-note">
        <p>תקציב, רזרבה והוצאות כלליות (אגרות, ביטוחים) מנוהלים ברמת כל הפרויקט, ולכן לא מופיעים כאן.</p>
        <button type="button" className="btn small" onClick={onAll}>
          הצגת כל הפרויקט
        </button>
      </section>
    </>
  );
}

/** Thin segmented bar of paid vs. still to pay, scaled to the zone's forecast. */
function PaidBar({ totals, title }: { totals: Totals; title: string }) {
  const scale = Math.max(totals.paid + totals.remaining, 1);
  const pct = (v: number) => `${(v / scale) * 100}%`;
  return (
    <Section title={title}>
      <div className="budget-bar" role="img" aria-label={`שולם ${formatILS(totals.paid)}, נותר לתשלום ${formatILS(totals.remaining)}`}>
        <div className="budget-track">
          {totals.paid > 0 && <span className="seg seg-paid" style={{ width: pct(totals.paid) }} />}
          {totals.remaining > 0 && <span className="seg seg-remaining" style={{ width: pct(totals.remaining) }} />}
        </div>
      </div>
      <ul className="legend">
        <li>
          <i className="swatch seg-paid" />
          שולם <b className="num">{formatILS(totals.paid)}</b>
        </li>
        <li>
          <i className="swatch seg-remaining" />
          נותר לתשלום <b className="num">{formatILS(totals.remaining)}</b>
        </li>
      </ul>
    </Section>
  );
}

// ---------- Shared pieces ----------

function Stat({
  label,
  value,
  sub,
  wide,
  children,
}: {
  label: string;
  value: number;
  sub?: string;
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`card stat ${wide ? 'stat-wide' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{formatILS(value)}</div>
      {children}
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ProgressSection({ title, value }: { title: string; value: number }) {
  return (
    <Section title={title}>
      <div className="progress-row">
        <Meter value={value} label={title} />
        <span className="progress-value">{formatPct(value)}</span>
      </div>
      <p className="hint">ממוצע ההתקדמות של התחומים, משוקלל לפי העלות הצפויה של כל תחום.</p>
    </Section>
  );
}

const ALERT_ICON: Record<Alert['level'], IconName> = { danger: 'alert', warning: 'alert', info: 'info' };
const ALERT_LABEL: Record<Alert['level'], string> = { danger: 'חשוב', warning: 'לתשומת לב', info: 'לידיעה' };

function Alerts({ alerts }: { alerts: Alert[] }) {
  return (
    <Section title="התראות">
      {alerts.length === 0 ? (
        <Empty>אין התראות. הכול בסדר.</Empty>
      ) : (
        <ul className="alerts">
          {alerts.map((a, i) => {
            const body = (
              <>
                <Icon name={ALERT_ICON[a.level]} className={`alert-icon ${a.level}`} />
                <span>
                  <span className="sr-only">{ALERT_LABEL[a.level]}: </span>
                  {a.message}
                </span>
              </>
            );
            return (
              <li key={`${a.code}-${i}`} className={`alert ${a.level}`}>
                {a.link ? <Link to={a.link}>{body}</Link> : <div>{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function UpcomingPayments({ payments }: { payments: Payment[] }) {
  const { data } = useData();
  const today = todayISO();
  const { displayBasis, vatRate } = data.settings;
  return (
    <Section title="תשלומים קרובים" action={<Link to="/payments">כל התשלומים</Link>}>
      {payments.length === 0 ? (
        <Empty>אין תשלומים מתוכננים ל־30 הימים הקרובים.</Empty>
      ) : (
        <ul className="rows">
          {payments.map((p) => (
            <li key={p.id}>
              <Link to={paymentTargetLink(p)} className="row">
                <span className="row-main">
                  <span className="row-title">{paymentTargetName(data, p)}</span>
                  <span className="row-sub">
                    {formatDate(p.date)} {p.date < today && <Chip tone="warning">עבר המועד</Chip>}
                  </span>
                </span>
                <Money value={toBasis(p.amount, p.vatMode, displayBasis, vatRate)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function totalsOfExpenses(s: ProjectSummary): Totals & { count: number } {
  return { ...zoneBreakdown(s).general };
}

function AreasTable({
  areas,
  totals,
  general,
  zone,
}: {
  areas: AreaCalc[];
  totals: Totals;
  general?: Totals & { count: number };
  zone?: Zone;
}) {
  const { data } = useData();
  const listLink = zone ? `/areas?zone=${zone}` : '/areas';
  return (
    <Section title="לפי תחום" action={<Link to={listLink}>כל התחומים</Link>}>
      {areas.length === 0 ? (
        <Empty>
          {zone ? `אין עדיין תחומים ב${ZONE_LABELS[zone]}.` : 'עוד לא הוגדרו תחומי עבודה.'} <Link to={listLink}>הוסיפו תחום</Link>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table areas-table">
            <thead>
              <tr>
                <th>תחום</th>
                <th>התקדמות</th>
                <th className="n">תחזית ₪</th>
                <th className="n">שולם ₪</th>
                <th className="n">נותר ₪</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => (
                <tr key={a.area.id}>
                  <td>
                    <Link to={`/areas/${a.area.id}`} className="cell-title">
                      {zone ? a.area.name : (areaName(data, a.area.id) ?? a.area.name)}
                    </Link>
                    <span className="cell-sub">
                      {!zone && `${ZONE_LABELS[a.area.zone]} · `}
                      {AREA_STATUS_LABELS[a.area.status]}
                      {a.forecastSource !== 'selected' && ` · ${AREA_FORECAST_SOURCE_LABELS[a.forecastSource]}`}
                    </span>
                  </td>
                  <td>
                    <div className="mini-progress">
                      <Meter value={a.area.progress} label={`התקדמות ${a.area.name}`} />
                      <span className="num">{a.area.progress}%</span>
                    </div>
                  </td>
                  <td className="n num">{formatNumber(a.forecast)}</td>
                  <td className="n num">{formatNumber(a.paid)}</td>
                  <td className="n num">{formatNumber(a.remaining)}</td>
                </tr>
              ))}
              {general && general.count > 0 && (
                <tr>
                  <td>
                    <Link to="/expenses" className="cell-title">
                      הוצאות כלליות
                    </Link>
                    <span className="cell-sub">{general.count} פריטים</span>
                  </td>
                  <td />
                  <td className="n num">{formatNumber(general.forecast)}</td>
                  <td className="n num">{formatNumber(general.paid)}</td>
                  <td className="n num">{formatNumber(general.remaining)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>{zone ? `סה"כ ${ZONE_LABELS[zone]}` : 'סה"כ'}</td>
                <td />
                <td className="n num">{formatNumber(totals.forecast)}</td>
                <td className="n num">{formatNumber(totals.paid)}</td>
                <td className="n num">{formatNumber(totals.remaining)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}
