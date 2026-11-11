import { describe, expect, it } from 'vitest';
import { describeEntry, digestLine, type AuditEntry } from './audit';
import { formatILS } from './money';

const entry = (e: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  at: '2026-11-09T12:05:00.000Z',
  actor: 'ofer.wiesel@gmail.com',
  action: 'update',
  entity: 'work_area',
  entityId: 'a1',
  label: 'חשמל ותאורה',
  changes: {},
  refs: {},
  ...e,
});

describe('describeEntry', () => {
  it('describes progress, status and amount changes in Hebrew', () => {
    const d = describeEntry(
      entry({ changes: { progress: [60, 80], status: ['in_progress', 'done'], estimateAmount: [null, 1200000] } }),
    );
    expect(d.title).toBe('עודכן תחום');
    expect(d.label).toBe('חשמל ותאורה');
    expect(d.details).toEqual([
      'סטטוס: מ־בביצוע ל־הושלם',
      'התקדמות: מ־60% ל־80%',
      `הערכת עלות: מ־ריק ל־${formatILS(1200000)}`,
    ]);
  });

  it('shows the zone of a new area and a move between zones', () => {
    const added = describeEntry(entry({ action: 'create', label: 'חשמל · משרד מחסן', changes: { name: 'חשמל', zone: 'office_warehouse', status: 'not_started' } }));
    expect(added.title).toBe('נוסף תחום');
    expect(added.details).toEqual(['אזור: משרד מחסן', 'סטטוס: טרם התחיל']);
    const moved = describeEntry(entry({ changes: { zone: ['store', 'exterior'] } }));
    expect(moved.details).toEqual(['אזור: מ־חנות ל־סגירת חוץ']);
  });

  it('names referenced items from the refs stored with the entry', () => {
    const d = describeEntry(entry({ changes: { selectedQuoteId: [null, 'q1'] }, refs: { q1: 'א.ב. חשמל · חשמל ותאורה' } }));
    expect(d.details).toEqual(['הצעה נבחרת: מ־ריק ל־א.ב. חשמל · חשמל ותאורה']);
  });

  it('summarizes added and deleted items', () => {
    const added = describeEntry(
      entry({ action: 'create', entity: 'payment', label: `${formatILS(500000)} · חשמל`, changes: { amount: 500000, status: 'paid', date: '2026-11-09', notes: 'x' } }),
    );
    expect(added.title).toBe('נוסף תשלום');
    expect(added.details).toEqual([`סכום: ${formatILS(500000)}`, 'סטטוס: שולם', 'תאריך: 09/11/2026']);

    const deleted = describeEntry(
      entry({ action: 'delete', entity: 'quote', label: 'ספק', changes: { amount: 100, vatMode: 'excl', cascade: 'נמחקו איתה 2 קבצים' } }),
    );
    expect(deleted.title).toBe('נמחקה הצעת מחיר');
    expect(deleted.details).toContain('נמחקו איתה 2 קבצים');
  });

  it('shows only file details, never contents', () => {
    const d = describeEntry(entry({ action: 'create', entity: 'quote_file', label: 'הצעה.pdf', changes: { fileName: 'הצעה.pdf', size: 2048 } }));
    expect(d).toEqual({ title: 'צורף קובץ', label: 'הצעה.pdf', details: ['גודל: 2 KB'] });
  });
});

describe('digestLine', () => {
  it('gives Israel time, the user, the item and the change', () => {
    expect(digestLine(entry({ changes: { progress: [60, 80] } }))).toBe(
      '14:05 · ofer.wiesel@gmail.com · עודכן תחום "חשמל ותאורה": התקדמות: מ־60% ל־80%',
    );
  });
});
