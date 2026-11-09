import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { formatDate, type Alert, type ProjectSummary } from '../../shared/calc';
import { AREA_FORECAST_SOURCE_LABELS, AREA_STATUS_LABELS, VAT_BASIS_LABELS } from '../../shared/labels';
import { formatILS, formatNumber, formatPct } from '../../shared/money';
import { toBasis } from '../../shared/vat';
import { Chip, Empty, Icon, Meter, Money, PageHeader, Section, type IconName } from '../components/ui';
import { todayISO, useData } from '../data';
import { InstallBanner } from './Install';
import { paymentTargetLink, paymentTargetName } from '../util';

export function Dashboard() {
  const { data, summary: s } = useData();
  return (
    <>
      <PageHeader
        title={data.settings.projectName}
        subtitle={`כל הסכומים ${VAT_BASIS_LABELS[data.settings.displayBasis]}`}
      />
      <InstallBanner />
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
      <BudgetBar s={s} />
      <Section title="התקדמות כוללת">
        <div className="progress-row">
          <Meter value={s.progress} label="התקדמות כוללת" />
          <span className="progress-value">{formatPct(s.progress)}</span>
        </div>
        <p className="hint">ממוצע ההתקדמות של התחומים, משוקלל לפי העלות הצפויה של כל תחום.</p>
      </Section>
      <Alerts alerts={s.alerts} />
      <UpcomingPayments />
      <AreasTable s={s} />
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

function UpcomingPayments() {
  const { data, summary } = useData();
  const today = todayISO();
  const { displayBasis, vatRate } = data.settings;
  return (
    <Section title="תשלומים קרובים" action={<Link to="/payments">כל התשלומים</Link>}>
      {summary.upcomingPayments.length === 0 ? (
        <Empty>אין תשלומים מתוכננים ל־30 הימים הקרובים.</Empty>
      ) : (
        <ul className="rows">
          {summary.upcomingPayments.map((p) => (
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

function AreasTable({ s }: { s: ProjectSummary }) {
  const expenses = s.expenses.reduce(
    (acc, e) => ({ forecast: acc.forecast + e.forecast, paid: acc.paid + e.paid, remaining: acc.remaining + e.remaining }),
    { forecast: 0, paid: 0, remaining: 0 },
  );
  return (
    <Section title="לפי תחום" action={<Link to="/areas">כל התחומים</Link>}>
      {s.areas.length === 0 ? (
        <Empty>
          עוד לא הוגדרו תחומי עבודה. <Link to="/areas">הוסיפו תחום</Link>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
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
              {s.areas.map((a) => (
                <tr key={a.area.id}>
                  <td>
                    <Link to={`/areas/${a.area.id}`} className="cell-title">
                      {a.area.name}
                    </Link>
                    <span className="cell-sub">
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
              {s.expenses.length > 0 && (
                <tr>
                  <td>
                    <Link to="/expenses" className="cell-title">
                      הוצאות כלליות
                    </Link>
                    <span className="cell-sub">{s.expenses.length} פריטים</span>
                  </td>
                  <td />
                  <td className="n num">{formatNumber(expenses.forecast)}</td>
                  <td className="n num">{formatNumber(expenses.paid)}</td>
                  <td className="n num">{formatNumber(expenses.remaining)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>סה"כ</td>
                <td />
                <td className="n num">{formatNumber(s.forecast)}</td>
                <td className="n num">{formatNumber(s.paid)}</td>
                <td className="n num">{formatNumber(s.remaining)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}
