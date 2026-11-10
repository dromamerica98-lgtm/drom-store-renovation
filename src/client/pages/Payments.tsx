import { useState } from 'react';
import { addDays, formatDate, UPCOMING_PAYMENT_DAYS } from '../../shared/calc';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, ZONE_LABELS, ZONE_ORDER } from '../../shared/labels';
import { formatILS } from '../../shared/money';
import type { Payment } from '../../shared/types';
import { toBasis } from '../../shared/vat';
import { AddButton, Chip, Empty, Icon, Money, PageHeader } from '../components/ui';
import { todayISO, useData } from '../data';
import { PaymentForm } from '../forms';
import { paymentPayee, paymentTargetName } from '../util';

type StatusFilter = 'all' | 'paid' | 'planned' | 'upcoming';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'הכול' },
  { value: 'paid', label: 'שולמו' },
  { value: 'planned', label: 'מתוכננים' },
  { value: 'upcoming', label: `${UPCOMING_PAYMENT_DAYS} הימים הקרובים` },
];

export function PaymentsPage() {
  const { data } = useData();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [target, setTarget] = useState('');
  const [supplier, setSupplier] = useState('');
  const [editing, setEditing] = useState<{ payment?: Payment } | null>(null);
  const today = todayISO();
  const limit = addDays(today, UPCOMING_PAYMENT_DAYS);
  const { displayBasis, vatRate } = data.settings;
  const norm = (p: Payment) => toBasis(p.amount, p.vatMode, displayBasis, vatRate);

  const filtered = data.payments
    .filter((p) => {
      if (status === 'paid' && p.status !== 'paid') return false;
      if (status === 'planned' && p.status !== 'planned') return false;
      if (status === 'upcoming' && !(p.status === 'planned' && p.date <= limit)) return false;
      if (target) {
        const key = p.workAreaId ? `area:${p.workAreaId}` : `expense:${p.expenseId}`;
        if (key !== target) return false;
      }
      if (supplier && paymentPayee(data, p)?.id !== supplier) return false;
      return true;
    })
    .sort((a, b) =>
      status === 'upcoming' || status === 'planned' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date),
    );
  const totalPaid = filtered.filter((p) => p.status === 'paid').reduce((s, p) => s + norm(p), 0);
  const totalPlanned = filtered.filter((p) => p.status === 'planned').reduce((s, p) => s + norm(p), 0);

  return (
    <>
      <PageHeader title="תשלומים" actions={<AddButton onClick={() => setEditing({})}>תשלום חדש</AddButton>} />
      <div className="filters">
        <div className="segmented" role="group" aria-label="סינון לפי סטטוס">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              className={status === f.value ? 'active' : ''}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="filter-selects">
          <select aria-label="סינון לפי תחום או הוצאה" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">כל התחומים וההוצאות</option>
            {ZONE_ORDER.map((zone) => (
              <optgroup key={zone} label={`תחומים · ${ZONE_LABELS[zone]}`}>
                {data.workAreas
                  .filter((a) => a.zone === zone)
                  .map((a) => (
                    <option key={a.id} value={`area:${a.id}`}>
                      {a.name}
                    </option>
                  ))}
              </optgroup>
            ))}
            <optgroup label="הוצאות כלליות">
              {data.expenses.map((e) => (
                <option key={e.id} value={`expense:${e.id}`}>
                  {e.description}
                </option>
              ))}
            </optgroup>
          </select>
          <select aria-label="סינון לפי ספק" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">כל הספקים</option>
            {data.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="card">
        <div className="totals">
          <span>
            שולם <b className="num">{formatILS(totalPaid)}</b>
          </span>
          <span>
            מתוכנן <b className="num">{formatILS(totalPlanned)}</b>
          </span>
          <span className="muted">{filtered.length} תשלומים</span>
        </div>
        {filtered.length === 0 ? (
          <Empty>אין תשלומים שמתאימים לסינון.</Empty>
        ) : (
          <ul className="rows">
            {filtered.map((p) => {
              const payee = paymentPayee(data, p);
              const overdue = p.status === 'planned' && p.date < today;
              return (
                <li key={p.id}>
                  <button type="button" className="row row-button" onClick={() => setEditing({ payment: p })}>
                    <span className="row-main">
                      <span className="row-title">{paymentTargetName(data, p)}</span>
                      <span className="row-sub">
                        <Chip tone={p.status === 'paid' ? 'accent' : overdue ? 'warning' : undefined}>
                          {overdue ? 'עבר המועד' : PAYMENT_STATUS_LABELS[p.status]}
                        </Chip>
                        {formatDate(p.date)}
                        {payee && ` · ${payee.name}`}
                        {p.method && ` · ${PAYMENT_METHOD_LABELS[p.method]}`}
                        {p.reference && ` · ${p.reference}`}
                      </span>
                    </span>
                    <Money value={norm(p)} />
                    <Icon name="chevron" className="row-chevron" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {editing && (
        <PaymentForm payment={editing.payment} target={target || undefined} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
