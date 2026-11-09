import { useState } from 'react';
import { Link } from 'react-router';
import { VAT_BASIS_LABELS } from '../../shared/labels';
import { agorotToInput, formatILS, parseShekels } from '../../shared/money';
import type { VatBasis } from '../../shared/types';
import { api } from '../api';
import { MoneyField, PageHeader, Section, Select, TextInput, setter } from '../components/ui';
import { useData } from '../data';

export function SettingsPage() {
  const { data, summary, run } = useData();
  const s = data.settings;
  const [f, setF] = useState({
    projectName: s.projectName,
    totalBudget: agorotToInput(s.totalBudget),
    budgetVat: s.budgetVat,
    reserveAmount: agorotToInput(s.reserveAmount),
    vatRate: String(s.vatRate),
    displayBasis: s.displayBasis,
  });
  const set = setter(setF);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaved(false);
    const totalBudget = parseShekels(f.totalBudget || '0');
    const reserveAmount = parseShekels(f.reserveAmount || '0');
    const vatRate = Number(f.vatRate);
    if (!f.projectName.trim()) return setError('יש למלא שם פרויקט');
    if (totalBudget === null || totalBudget < 0) return setError('תקציב כולל: סכום לא תקין');
    if (reserveAmount === null || reserveAmount < 0) return setError('רזרבה: סכום לא תקין');
    if (reserveAmount > totalBudget) return setError('הרזרבה לא יכולה להיות גדולה מהתקציב הכולל');
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) return setError('שיעור מע"מ לא תקין');
    setError(null);
    const ok = await run(() =>
      api.saveSettings({
        projectName: f.projectName.trim(),
        totalBudget,
        budgetVat: f.budgetVat,
        reserveAmount,
        vatRate,
        displayBasis: f.displayBasis,
      }),
    );
    setSaved(ok);
  };

  return (
    <>
      <PageHeader title="הגדרות" subtitle={`מחובר כ־${data.user.email}`} />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Section title="פרויקט ותקציב">
          <TextInput label="שם הפרויקט" value={f.projectName} onChange={set('projectName')} required />
          <MoneyField
            label="תקציב כולל"
            amount={f.totalBudget}
            onAmount={set('totalBudget')}
            vat={f.budgetVat}
            onVat={(v) => set('budgetVat')(v as VatBasis)}
            modes={['excl', 'incl']}
          />
          <MoneyField
            label="רזרבה (חלק מהתקציב הכולל)"
            amount={f.reserveAmount}
            onAmount={set('reserveAmount')}
            vat={f.budgetVat}
            onVat={(v) => set('budgetVat')(v as VatBasis)}
            modes={['excl', 'incl']}
          />
          <p className="hint">
            הרזרבה נשמרת בצד. כשתחזית העלות עוברת את התקציב פחות הרזרבה, ההפרש יורד מהרזרבה. כשהרזרבה נגמרת,
            כל סכום נוסף הוא חריגה.
            {summary.reserve > 0 && ` כרגע נוצלו ${formatILS(summary.reserveUsed)} ונותרו ${formatILS(summary.reserveRemaining)}.`}
          </p>
        </Section>
        <Section title='מע"מ'>
          <Select
            label="הצגת התקציב והדוחות"
            value={f.displayBasis}
            onChange={set('displayBasis')}
            options={VAT_BASIS_LABELS}
            hint='כל סכום מומר לפי הסימון שלו (כולל, לפני או פטור ממע"מ) ומוצג לפי הבחירה כאן.'
          />
          <TextInput label='שיעור מע"מ (%)' value={f.vatRate} onChange={set('vatRate')} inputMode="decimal" />
        </Section>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Section title="התקנה במסך הבית">
          <p className="hint">אפשר להתקין את האפליקציה כאייקון במסך הבית של האייפון או האנדרואיד, ולפתוח אותה במסך מלא.</p>
          <Link to="/install" className="btn small install-link">
            הוראות התקנה
          </Link>
        </Section>
        <div className="form-actions">
          <button type="submit" className="btn primary">
            שמירת ההגדרות
          </button>
          {saved && <span className="saved">נשמר ✓</span>}
        </div>
      </form>
    </>
  );
}
