import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { VAT_BASIS_LABELS, VAT_MODE_LABELS } from '../../shared/labels';
import { agorotToInput, formatILS, parseShekels } from '../../shared/money';
import type { VatBasis, VatMode } from '../../shared/types';
import { toBasis } from '../../shared/vat';
import { useData } from '../data';

// ---------- Icons ----------

const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  areas: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  expenses: (
    <>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 2v6h6M9 13h8M9 17h8" />
    </>
  ),
  payments: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </>
  ),
  suppliers: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-7 7-7s7 3 7 7M16 4.5a4 4 0 0 1 0 7M22 21c0-3-1.8-5.4-4.5-6.4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="m9 6 6 6-6 6" />,
  chevron: <path d="m15 6-6 6 6 6" />,
  check: <path d="m5 12 5 5 9-10" />,
  alert: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  phone: <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

// ---------- Layout pieces ----------

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      {back && (
        <Link to={back} className="back-link">
          <Icon name="back" />
          חזרה
        </Link>
      )}
      <div className="page-header-row">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="btn small" onClick={onClick}>
      <Icon name="plus" />
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button type="button" className={`icon-btn ${danger ? 'danger' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Chip({ children, tone }: { children: ReactNode; tone?: 'good' | 'warning' | 'critical' | 'accent' }) {
  return <span className={`chip ${tone ?? ''}`}>{children}</span>;
}

/** Progress / ratio meter: accent fill on a lighter step of the same hue. */
export function Meter({ value, label, tone }: { value: number; label: string; tone?: 'warning' | 'critical' }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`meter ${tone ?? ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={`num ${className ?? ''}`}>{formatILS(value)}</span>;
}

/** A label/value pair for compact figure rows. */
export function Figure({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="figure">
      <span className="figure-label">{label}</span>
      <span className="figure-value">{value}</span>
      {note && <span className="figure-note">{note}</span>}
    </div>
  );
}

// ---------- Forms ----------

/** A modal form. Render it conditionally; it opens on mount. */
export function Sheet({
  title,
  onClose,
  onSubmit,
  busy,
  error,
  submitLabel = 'שמירה',
  onDelete,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
  submitLabel?: string;
  /** Shown as a delete button in the footer when editing an existing record. */
  onDelete?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </header>
        <div className="sheet-body">
          {children}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="sheet-foot">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'שומר…' : submitLabel}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          {onDelete && (
            <button type="button" className="btn danger-text" onClick={onDelete} disabled={busy}>
              <Icon name="trash" />
              מחיקה
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  required,
  hint,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'tel' | 'email' | 'date';
  required?: boolean;
  hint?: ReactNode;
  inputMode?: 'text' | 'tel' | 'email' | 'numeric' | 'decimal';
}) {
  return (
    <Field label={required ? `${label} *` : label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type={type}
          value={value}
          required={required}
          inputMode={inputMode}
          dir={type === 'email' || type === 'tel' ? 'ltr' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      {(id) => <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[] | Record<T, string>;
  hint?: ReactNode;
}) {
  const list = Array.isArray(options)
    ? options
    : (Object.entries(options) as [T, string][]).map(([v, l]) => ({ value: v, label: l }));
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * An amount in shekels plus its VAT marking. Shows the amount converted to the
 * project's display basis when the two differ.
 */
export function MoneyField({
  label,
  amount,
  onAmount,
  vat,
  onVat,
  required,
  allowNegative,
  modes = ['excl', 'incl', 'exempt'],
}: {
  label: string;
  amount: string;
  onAmount: (v: string) => void;
  vat: VatMode;
  onVat: (v: VatMode) => void;
  required?: boolean;
  allowNegative?: boolean;
  modes?: VatMode[];
}) {
  const { data } = useData();
  const id = useId();
  const basis: VatBasis = data.settings.displayBasis;
  const parsed = parseShekels(amount);
  const converted = parsed === null ? null : toBasis(parsed, vat, basis, data.settings.vatRate);
  return (
    <div className="field">
      <label htmlFor={id}>{required ? `${label} *` : label}</label>
      <div className="money-row">
        <input
          id={id}
          className="money-input"
          inputMode={allowNegative ? 'text' : 'decimal'}
          dir="ltr"
          placeholder="0"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          onBlur={() => {
            if (parsed !== null) onAmount(agorotToInput(parsed));
          }}
        />
        <span className="currency">₪</span>
        <select aria-label={`${label}: מע"מ`} value={vat} onChange={(e) => onVat(e.target.value as VatMode)}>
          {modes.map((m) => (
            <option key={m} value={m}>
              {VAT_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      {converted !== null && converted !== parsed && (
        <p className="hint">
          = {formatILS(converted)} {VAT_BASIS_LABELS[basis]}
        </p>
      )}
    </div>
  );
}

/** Returns a setter factory for a form-state object. */
export function setter<T>(set: (fn: (prev: T) => T) => void) {
  return <K extends keyof T>(key: K) =>
    (value: T[K]) =>
      set((prev) => ({ ...prev, [key]: value }));
}
