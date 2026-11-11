import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatDate, supplierMissing, type AreaCalc } from '../../shared/calc';
import {
  AREA_FORECAST_SOURCE_LABELS,
  AREA_STATUS_LABELS,
  CHANGE_ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  VAT_MODE_LABELS,
  ZONE_LABELS,
  ZONE_ORDER,
  countOf,
} from '../../shared/labels';
import { formatILS, formatSignedILS } from '../../shared/money';
import type { ChangeOrder, Payment, Quote } from '../../shared/types';
import { toBasis } from '../../shared/vat';
import { api } from '../api';
import {
  AddButton,
  Chip,
  Empty,
  Figure,
  Icon,
  IconButton,
  Meter,
  Money,
  PageHeader,
  Section,
} from '../components/ui';
import { QuoteFiles } from '../components/QuoteFiles';
import { useZoneFilter, ZoneFilter } from '../components/ZoneFilter';
import { useData } from '../data';
import { AreaForm, ChangeOrderForm, PaymentForm, QuoteForm, SupplierChoiceForm } from '../forms';
import { supplierName } from '../util';

export function AreasPage() {
  const { summary } = useData();
  const [adding, setAdding] = useState(false);
  const [zone, setZone] = useZoneFilter();
  const shown = zone === 'all' ? summary.areas : summary.areas.filter((a) => a.area.zone === zone);
  const forecast = shown.reduce((t, a) => t + a.forecast, 0);
  return (
    <>
      <PageHeader
        title="תחומי עבודה"
        subtitle={`${zone === 'all' ? '' : `${ZONE_LABELS[zone]} · `}${countOf(shown.length, 'תחום', 'תחומים')} · תחזית ${formatILS(forecast)}`}
        actions={<AddButton onClick={() => setAdding(true)}>תחום חדש</AddButton>}
      />
      <ZoneFilter value={zone} onChange={setZone} allLabel="כל האזורים" />
      {summary.areas.length === 0 ? (
        <section className="card">
          <Empty>עוד לא הוגדרו תחומי עבודה. לדוגמה: חשמל, אינסטלציה, ריצוף, מיזוג.</Empty>
        </section>
      ) : zone === 'all' ? (
        ZONE_ORDER.map((z) => {
          const areas = summary.areas.filter((a) => a.area.zone === z);
          if (!areas.length) return null;
          return (
            <section key={z} className="zone-group">
              <h2 className="zone-heading">
                <i className={`zone-dot zone-${z}`} aria-hidden="true" />
                {ZONE_LABELS[z]}
                <span className="muted">
                  {countOf(areas.length, 'תחום', 'תחומים')} · {formatILS(areas.reduce((t, a) => t + a.forecast, 0))}
                </span>
              </h2>
              <AreaCards areas={areas} />
            </section>
          );
        })
      ) : shown.length === 0 ? (
        <section className="card">
          <Empty>אין עדיין תחומים ב{ZONE_LABELS[zone]}. הוסיפו תחום עם "תחום חדש".</Empty>
        </section>
      ) : (
        <AreaCards areas={shown} />
      )}
      {adding && <AreaForm defaultZone={zone === 'all' ? undefined : zone} onClose={() => setAdding(false)} />}
    </>
  );
}

function AreaCards({ areas }: { areas: AreaCalc[] }) {
  const { data } = useData();
  return (
    <ul className="cards">
      {areas.map((a) => {
        const supplierId = a.selectedQuote?.supplierId;
        return (
          <li key={a.area.id}>
            <Link to={`/areas/${a.area.id}`} className="card area-card">
              <div className="area-card-head">
                <span className="area-name">{a.area.name}</span>
                <Chip>{AREA_STATUS_LABELS[a.area.status]}</Chip>
              </div>
              <div className="area-card-sub">
                {supplierId ? (
                  `ספק: ${supplierName(data, supplierId)}`
                ) : supplierMissing(a.area) ? (
                  <>
                    <span className="supplier-missing">ספק: לא צוין</span> · {AREA_FORECAST_SOURCE_LABELS[a.forecastSource]}
                  </>
                ) : (
                  AREA_FORECAST_SOURCE_LABELS[a.forecastSource]
                )}
              </div>
              <div className="progress-row">
                <Meter value={a.area.progress} label={`התקדמות ${a.area.name}`} />
                <span className="num">{a.area.progress}%</span>
              </div>
              <div className="figures">
                <Figure label="תחזית" value={<Money value={a.forecast} />} />
                <Figure label="שולם" value={<Money value={a.paid} />} />
                <Figure label="נותר" value={<Money value={a.remaining} />} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type Editing =
  | { kind: 'area' }
  | { kind: 'supplier' }
  | { kind: 'quote'; quote?: Quote }
  | { kind: 'change'; change?: ChangeOrder }
  | { kind: 'payment'; payment?: Payment }
  | null;

export function AreaPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, summary, run } = useData();
  const [editing, setEditing] = useState<Editing>(null);
  const calc = summary.areas.find((a) => a.area.id === id);
  if (!calc) {
    return (
      <>
        <PageHeader title="התחום לא נמצא" back="/areas" />
      </>
    );
  }
  const { area } = calc;
  const { displayBasis, vatRate } = data.settings;
  const norm = (amount: number, mode: Quote['vatMode']) => toBasis(amount, mode, displayBasis, vatRate);
  const quotes = data.quotes
    .filter((q) => q.workAreaId === area.id)
    .sort((a, b) => Number(a.status === 'rejected') - Number(b.status === 'rejected') || norm(a.amount, a.vatMode) - norm(b.amount, b.vatMode));
  const changes = data.changeOrders.filter((c) => c.workAreaId === area.id);
  const payments = data.payments.filter((p) => p.workAreaId === area.id);
  const close = () => setEditing(null);

  const deleteArea = async () => {
    if (!confirm(`למחוק את התחום "${area.name}" עם כל הצעות המחיר, הקבצים והתוספות שלו?`)) return;
    if (await run(() => api.remove('areas', area.id))) navigate('/areas');
  };

  return (
    <>
      <PageHeader
        back="/areas"
        title={area.name}
        subtitle={
          <span className="chips-inline">
            <Chip>
              <i className={`zone-dot zone-${area.zone}`} aria-hidden="true" />
              {ZONE_LABELS[area.zone]}
            </Chip>
            <Chip>{AREA_STATUS_LABELS[area.status]}</Chip>
          </span>
        }
        actions={
          <>
            <IconButton icon="edit" label="עריכת התחום" onClick={() => setEditing({ kind: 'area' })} />
            <IconButton icon="trash" label="מחיקת התחום" onClick={() => void deleteArea()} danger />
          </>
        }
      />

      <section className="card">
        <div className="figures">
          <Figure
            label="תחזית"
            value={<Money value={calc.forecast} />}
            note={AREA_FORECAST_SOURCE_LABELS[calc.forecastSource]}
          />
          <Figure label="שולם" value={<Money value={calc.paid} />} />
          <Figure label="נותר לתשלום" value={<Money value={calc.remaining} />} />
        </div>
        {calc.approvedChanges !== 0 && (
          <p className="hint">כולל תוספות שאושרו: {formatSignedILS(calc.approvedChanges)}</p>
        )}
        {calc.overpaid > 0 && (
          <p className="inline-alert danger">
            <Icon name="alert" /> שולם {formatILS(calc.overpaid)} יותר מהתחזית.
          </p>
        )}
        <ProgressEditor areaId={area.id} progress={area.progress} paidPct={calc.paidPct} />
        {area.notes && <p className="notes">{area.notes}</p>}
      </section>

      <ChosenSupplier calc={calc} onChoose={() => setEditing({ kind: 'supplier' })} />

      <Section title="הצעות מחיר" action={<AddButton onClick={() => setEditing({ kind: 'quote' })}>הצעה</AddButton>}>
        {quotes.length === 0 ? (
          <Empty>עוד אין הצעות מחיר לתחום הזה.</Empty>
        ) : (
          <ul className="quotes">
            {quotes.map((q) => {
              const selected = q.id === area.selectedQuoteId;
              const normalized = norm(q.amount, q.vatMode);
              const lowest = q.status === 'open' && normalized === calc.lowestQuote && quotes.filter((x) => x.status === 'open').length > 1;
              return (
                <li key={q.id} className={`quote ${selected ? 'selected' : ''} ${q.status === 'rejected' ? 'rejected' : ''}`}>
                  <div className="quote-head">
                    <span className="quote-supplier">{supplierName(data, q.supplierId)}</span>
                    <span className="quote-amount num">{formatILS(normalized)}</span>
                  </div>
                  <div className="quote-meta">
                    {selected && (
                      <Chip tone="accent">
                        <Icon name="check" /> נבחרה
                      </Chip>
                    )}
                    {lowest && <Chip>הזולה ביותר</Chip>}
                    {q.status === 'rejected' && <Chip>נדחתה</Chip>}
                    <span>
                      {formatILS(q.amount)} {VAT_MODE_LABELS[q.vatMode]}
                    </span>
                    {q.receivedDate && <span>התקבלה {formatDate(q.receivedDate)}</span>}
                    {q.validUntil && <span>בתוקף עד {formatDate(q.validUntil)}</span>}
                  </div>
                  {q.description && <p className="quote-desc">{q.description}</p>}
                  <QuoteFiles quoteId={q.id} />
                  <div className="quote-actions">
                    {q.status === 'open' &&
                      (selected ? (
                        <button type="button" className="btn small" onClick={() => void run(() => api.selectQuote(area.id, null))}>
                          ביטול הבחירה
                        </button>
                      ) : (
                        <button type="button" className="btn small primary" onClick={() => void run(() => api.selectQuote(area.id, q.id))}>
                          בחירת ההצעה
                        </button>
                      ))}
                    <IconButton icon="edit" label="עריכה או מחיקה של ההצעה" onClick={() => setEditing({ kind: 'quote', quote: q })} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="תוספות לחוזה" action={<AddButton onClick={() => setEditing({ kind: 'change' })}>תוספת</AddButton>}>
        {changes.length === 0 ? (
          <Empty>אין תוספות.</Empty>
        ) : (
          <ul className="rows">
            {changes.map((c) => (
              <li key={c.id} className="row">
                <button type="button" className="row-button" onClick={() => setEditing({ kind: 'change', change: c })}>
                  <span className="row-main">
                    <span className="row-title">{c.description}</span>
                    <span className="row-sub">
                      <Chip tone={c.status === 'approved' ? 'accent' : undefined}>{CHANGE_ORDER_STATUS_LABELS[c.status]}</Chip>
                      {c.date && formatDate(c.date)}
                    </span>
                  </span>
                  <span className="num">{formatSignedILS(norm(c.amount, c.vatMode))}</span>
                </button>
                {c.status === 'pending' && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() =>
                      void run(() =>
                        api.update('change-orders', c.id, {
                          description: c.description,
                          amount: c.amount,
                          vatMode: c.vatMode,
                          date: c.date,
                          status: 'approved',
                        }),
                      )
                    }
                  >
                    אישור
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="תשלומים" action={<AddButton onClick={() => setEditing({ kind: 'payment' })}>תשלום</AddButton>}>
        <PaymentList payments={payments} onEdit={(p) => setEditing({ kind: 'payment', payment: p })} />
      </Section>

      {editing?.kind === 'area' && <AreaForm area={area} onClose={close} />}
      {editing?.kind === 'supplier' && <SupplierChoiceForm area={area} onClose={close} />}
      {editing?.kind === 'quote' && <QuoteForm areaId={area.id} quote={editing.quote} onClose={close} />}
      {editing?.kind === 'change' && <ChangeOrderForm areaId={area.id} change={editing.change} onClose={close} />}
      {editing?.kind === 'payment' && <PaymentForm payment={editing.payment} target={`area:${area.id}`} onClose={close} />}
    </>
  );
}

/** Which supplier was chosen for the area, with a way to choose or replace it. */
function ChosenSupplier({ calc, onChoose }: { calc: AreaCalc; onChoose: () => void }) {
  const { data } = useData();
  const { area, selectedQuote } = calc;
  const { displayBasis, vatRate } = data.settings;
  return (
    <Section
      title="ספק נבחר"
      action={
        <button type="button" className={`btn small ${selectedQuote ? '' : 'primary'}`} onClick={onChoose}>
          {selectedQuote ? 'החלפה' : 'בחירת ספק'}
        </button>
      }
    >
      {selectedQuote ? (
        <>
          <div className="chosen-supplier">
            <span className="chosen-supplier-name">{supplierName(data, selectedQuote.supplierId)}</span>
            <Money value={toBasis(selectedQuote.amount, selectedQuote.vatMode, displayBasis, vatRate)} className="chosen-supplier-amount" />
          </div>
          <p className="hint">
            סכום מוסכם {formatILS(selectedQuote.amount)} {VAT_MODE_LABELS[selectedQuote.vatMode]}, לפי ההצעה הנבחרת
            {calc.approvedChanges !== 0 && `, ועוד תוספות שאושרו ${formatSignedILS(calc.approvedChanges)}`}.
          </p>
        </>
      ) : supplierMissing(area) ? (
        <p className="inline-alert warning">
          <Icon name="alert" /> התחום מסומן "{AREA_STATUS_LABELS[area.status]}", אבל עוד לא צוין איזה ספק נבחר.
        </p>
      ) : (
        <p className="hint">עוד לא נבחר ספק. כשתבחרו, התחזית של התחום תתבסס על הסכום המוסכם.</p>
      )}
    </Section>
  );
}

/** Quick progress update with a slider, without opening the full form. */
function ProgressEditor({ areaId, progress, paidPct }: { areaId: string; progress: number; paidPct: number | null }) {
  const { data, run } = useData();
  const [value, setValue] = useState(progress);
  const [prev, setPrev] = useState(progress);
  if (prev !== progress) {
    setPrev(progress);
    setValue(progress);
  }
  const area = data.workAreas.find((a) => a.id === areaId);
  const save = () => {
    if (!area) return;
    let status = area.status;
    if (value === 100) status = 'done';
    else if (status === 'done' || (value > 0 && status === 'supplier_selected')) status = 'in_progress';
    void run(() =>
      api.update('areas', area.id, {
        name: area.name,
        zone: area.zone,
        status,
        progress: value,
        estimateAmount: area.estimateAmount,
        estimateVat: area.estimateVat,
        notes: area.notes,
        sortOrder: area.sortOrder,
      }),
    );
  };
  return (
    <div className="progress-editor">
      <label htmlFor="progress-range">
        התקדמות: <b className="num">{value}%</b>
        {paidPct !== null && <span className="hint-inline"> · שולמו {Math.round(paidPct)}% מהתחזית</span>}
      </label>
      <div className="progress-editor-row">
        <input
          id="progress-range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
        />
        {value !== progress && (
          <button type="button" className="btn small primary" onClick={save}>
            שמירה
          </button>
        )}
      </div>
    </div>
  );
}

export function PaymentList({ payments, onEdit }: { payments: Payment[]; onEdit: (p: Payment) => void }) {
  const { data } = useData();
  const { displayBasis, vatRate } = data.settings;
  if (payments.length === 0) return <Empty>אין תשלומים.</Empty>;
  return (
    <ul className="rows">
      {payments.map((p) => (
        <li key={p.id}>
          <button type="button" className="row row-button" onClick={() => onEdit(p)}>
            <span className="row-main">
              <span className="row-title">
                {formatDate(p.date)} {p.reference && <span className="muted">· {p.reference}</span>}
              </span>
              <span className="row-sub">
                <Chip tone={p.status === 'paid' ? 'accent' : undefined}>{PAYMENT_STATUS_LABELS[p.status]}</Chip>
                {formatILS(p.amount)} {VAT_MODE_LABELS[p.vatMode]}
              </span>
            </span>
            <Money value={toBasis(p.amount, p.vatMode, displayBasis, vatRate)} />
            <Icon name="chevron" className="row-chevron" />
          </button>
        </li>
      ))}
    </ul>
  );
}
