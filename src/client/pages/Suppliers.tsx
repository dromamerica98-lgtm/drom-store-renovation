import { useState } from 'react';
import { Link } from 'react-router';
import type { Supplier } from '../../shared/types';
import { AddButton, Chip, Empty, Icon, IconButton, PageHeader } from '../components/ui';
import { useData } from '../data';
import { SupplierForm } from '../forms';

export function SuppliersPage() {
  const { data } = useData();
  const [editing, setEditing] = useState<{ supplier?: Supplier } | null>(null);
  const areaName = new Map(data.workAreas.map((a) => [a.id, a.name]));

  return (
    <>
      <PageHeader title="ספקים" actions={<AddButton onClick={() => setEditing({})}>ספק חדש</AddButton>} />
      {data.suppliers.length === 0 ? (
        <section className="card">
          <Empty>עוד אין ספקים. אפשר להוסיף ספק גם ישירות מתוך הצעת מחיר.</Empty>
        </section>
      ) : (
        <ul className="cards">
          {data.suppliers.map((s) => {
            const quotes = data.quotes.filter((q) => q.supplierId === s.id);
            const areas = [...new Set(quotes.map((q) => q.workAreaId))].map((areaId) => ({
              id: areaId,
              name: areaName.get(areaId) ?? '',
              selected: data.workAreas.some((a) => a.id === areaId && quotes.some((q) => q.id === a.selectedQuoteId)),
            }));
            return (
              <li key={s.id} className="card supplier">
                <div className="area-card-head">
                  <span className="area-name">{s.name}</span>
                  <IconButton icon="edit" label="עריכה או מחיקה של הספק" onClick={() => setEditing({ supplier: s })} />
                </div>
                {s.contactName && <div className="area-card-sub">{s.contactName}</div>}
                <div className="contact">
                  {s.phone && (
                    <a href={`tel:${s.phone}`} dir="ltr">
                      <Icon name="phone" /> {s.phone}
                    </a>
                  )}
                  {s.email && (
                    <a href={`mailto:${s.email}`} dir="ltr">
                      <Icon name="mail" /> {s.email}
                    </a>
                  )}
                  {s.taxId && <span className="muted">ח.פ. {s.taxId}</span>}
                </div>
                {areas.length > 0 && (
                  <div className="chips">
                    {areas.map((a) => (
                      <Link key={a.id} to={`/areas/${a.id}`}>
                        <Chip tone={a.selected ? 'accent' : undefined}>
                          {a.selected && <Icon name="check" />}
                          {a.name}
                        </Chip>
                      </Link>
                    ))}
                  </div>
                )}
                {s.notes && <p className="notes">{s.notes}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <SupplierForm supplier={editing.supplier} onClose={() => setEditing(null)} />}
    </>
  );
}
