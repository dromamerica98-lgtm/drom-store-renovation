import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_FORECAST_SOURCE_LABELS, VAT_MODE_LABELS } from '../../shared/labels';
import { formatILS } from '../../shared/money';
import type { Payment } from '../../shared/types';
import { api } from '../api';
import { AddButton, Chip, Empty, Figure, IconButton, Money, PageHeader, Section } from '../components/ui';
import { useData } from '../data';
import { ExpenseForm, PaymentForm } from '../forms';
import { PaymentList } from './Areas';

export function ExpensesPage() {
  const { summary } = useData();
  const [adding, setAdding] = useState(false);
  const total = summary.forecastExpenses;
  return (
    <>
      <PageHeader
        title="הוצאות כלליות"
        subtitle={`אגרות, ביטוחים, היתרים ויועצים · תחזית ${formatILS(total)}`}
        actions={<AddButton onClick={() => setAdding(true)}>הוצאה חדשה</AddButton>}
      />
      {summary.expenses.length === 0 ? (
        <section className="card">
          <Empty>עוד אין הוצאות כלליות.</Empty>
        </section>
      ) : (
        <ul className="cards">
          {summary.expenses.map((e) => (
            <li key={e.expense.id}>
              <Link to={`/expenses/${e.expense.id}`} className="card area-card">
                <div className="area-card-head">
                  <span className="area-name">{e.expense.description}</span>
                  <Chip>{EXPENSE_CATEGORY_LABELS[e.expense.category]}</Chip>
                </div>
                <div className="area-card-sub">
                  {e.expense.payee ? `${e.expense.payee} · ` : ''}
                  {EXPENSE_FORECAST_SOURCE_LABELS[e.forecastSource]}
                </div>
                <div className="figures">
                  <Figure label="תחזית" value={<Money value={e.forecast} />} />
                  <Figure label="שולם" value={<Money value={e.paid} />} />
                  <Figure label="נותר" value={<Money value={e.remaining} />} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && <ExpenseForm onClose={() => setAdding(false)} />}
    </>
  );
}

type Editing = { kind: 'expense' } | { kind: 'payment'; payment?: Payment } | null;

export function ExpensePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, summary, run } = useData();
  const [editing, setEditing] = useState<Editing>(null);
  const calc = summary.expenses.find((e) => e.expense.id === id);
  if (!calc) return <PageHeader title="ההוצאה לא נמצאה" back="/expenses" />;
  const { expense } = calc;
  const payments = data.payments.filter((p) => p.expenseId === expense.id);
  const close = () => setEditing(null);

  const deleteExpense = async () => {
    if (!confirm(`למחוק את ההוצאה "${expense.description}"?`)) return;
    if (await run(() => api.remove('expenses', expense.id))) navigate('/expenses');
  };

  return (
    <>
      <PageHeader
        back="/expenses"
        title={expense.description}
        subtitle={<Chip>{EXPENSE_CATEGORY_LABELS[expense.category]}</Chip>}
        actions={
          <>
            <IconButton icon="edit" label="עריכת ההוצאה" onClick={() => setEditing({ kind: 'expense' })} />
            <IconButton icon="trash" label="מחיקת ההוצאה" onClick={() => void deleteExpense()} danger />
          </>
        }
      />
      <section className="card">
        <div className="figures">
          <Figure label="תחזית" value={<Money value={calc.forecast} />} note={EXPENSE_FORECAST_SOURCE_LABELS[calc.forecastSource]} />
          <Figure label="שולם" value={<Money value={calc.paid} />} />
          <Figure label="נותר לתשלום" value={<Money value={calc.remaining} />} />
        </div>
        <dl className="details">
          {expense.payee && (
            <>
              <dt>למי משלמים</dt>
              <dd>{expense.payee}</dd>
            </>
          )}
          <dt>הערכה</dt>
          <dd>
            {expense.estimateAmount === null ? '—' : `${formatILS(expense.estimateAmount)} ${VAT_MODE_LABELS[expense.estimateVat]}`}
          </dd>
          <dt>סכום בפועל</dt>
          <dd>{expense.actualAmount === null ? '—' : `${formatILS(expense.actualAmount)} ${VAT_MODE_LABELS[expense.actualVat]}`}</dd>
        </dl>
        {expense.notes && <p className="notes">{expense.notes}</p>}
      </section>
      <Section title="תשלומים" action={<AddButton onClick={() => setEditing({ kind: 'payment' })}>תשלום</AddButton>}>
        <PaymentList payments={payments} onEdit={(p) => setEditing({ kind: 'payment', payment: p })} />
      </Section>
      {editing?.kind === 'expense' && <ExpenseForm expense={expense} onClose={close} />}
      {editing?.kind === 'payment' && <PaymentForm payment={editing.payment} target={`expense:${expense.id}`} onClose={close} />}
    </>
  );
}
