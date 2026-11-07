-- Sample data for local development: npm run db:seed:local
-- Replaces all existing data. Amounts are in agorot.

DELETE FROM payments;
DELETE FROM change_orders;
DELETE FROM quotes;
DELETE FROM work_areas;
DELETE FROM expenses;
DELETE FROM suppliers;

UPDATE settings SET
  project_name = 'שיפוץ החנות החדשה',
  total_budget = 56000000,
  budget_vat = 'excl',
  reserve_amount = 6000000,
  vat_rate = 18,
  display_basis = 'excl',
  updated_at = '2026-11-01T09:00:00.000Z',
  updated_by = 'נתוני דוגמה'
WHERE id = 1;

INSERT INTO suppliers (id, name, contact_name, phone, email, tax_id, notes, created_at, created_by, updated_at, updated_by) VALUES
  ('sup-elec-1', 'א.ב. חשמל ותאורה', 'אבי', '050-1234567', 'avi@example.com', '512345678', NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('sup-elec-2', 'חשמל הצפון', 'רונית', '052-7654321', NULL, NULL, NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('sup-plumb', 'אינסטלציה כהן', 'משה כהן', '054-1112233', NULL, '034567891', NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('sup-gypsum', 'גבס ותקרות לוי', 'יוסי לוי', '053-4445566', NULL, NULL, NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('sup-tiles-1', 'קרמיקה וריצוף בע"מ', 'דנה', '058-9998877', 'dana@example.com', NULL, NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('sup-tiles-2', 'ריצוף מודרני', NULL, '050-5556677', NULL, NULL, NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('sup-carpentry', 'נגרות עוז', 'עוז', '052-3334455', NULL, NULL, 'מכין גם את דלפק הקופה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה');

INSERT INTO work_areas (id, name, status, progress, estimate_amount, estimate_vat, selected_quote_id, notes, sort_order, created_at, created_by, updated_at, updated_by) VALUES
  ('area-elec', 'חשמל ותאורה', 'in_progress', 60, NULL, 'excl', 'q-elec-1', NULL, 1, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('area-plumb', 'אינסטלציה', 'in_progress', 80, NULL, 'excl', 'q-plumb', NULL, 2, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('area-gypsum', 'גבס ותקרות', 'in_progress', 20, NULL, 'excl', 'q-gypsum', NULL, 3, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('area-tiles', 'ריצוף', 'collecting_quotes', 0, NULL, 'excl', NULL, 'כ־180 מ"ר, כולל פאנלים', 4, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('area-hvac', 'מיזוג אוויר', 'not_started', 0, 7000000, 'excl', NULL, NULL, 5, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('area-carpentry', 'נגרות ודלפקים', 'collecting_quotes', 0, 9000000, 'excl', NULL, NULL, 6, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('area-signs', 'שילוט', 'not_started', 0, NULL, 'excl', NULL, NULL, 7, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה');

INSERT INTO quotes (id, work_area_id, supplier_id, amount, vat_mode, received_date, valid_until, description, status, file_key, file_name, created_at, created_by, updated_at, updated_by) VALUES
  ('q-elec-1', 'area-elec', 'sup-elec-1', 8200000, 'excl', '2026-09-20', '2026-10-20', 'לוח חשמל חדש, 60 נקודות, תאורת מסילה', 'open', NULL, NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('q-elec-2', 'area-elec', 'sup-elec-2', 9900000, 'incl', '2026-09-24', '2026-10-24', 'לוח חשמל, 55 נקודות', 'open', NULL, NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('q-plumb', 'area-plumb', 'sup-plumb', 3800000, 'excl', '2026-09-18', NULL, 'שירותים, מטבחון, ניקוז מזגנים', 'open', NULL, NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('q-gypsum', 'area-gypsum', 'sup-gypsum', 6400000, 'excl', '2026-09-25', NULL, 'תקרה אקוסטית ומחיצות', 'open', NULL, NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('q-tiles-1', 'area-tiles', 'sup-tiles-1', 11000000, 'excl', '2026-10-28', '2026-11-15', 'פורצלן 60×120, כולל חומר', 'open', NULL, NULL, '2026-10-28T09:00:00.000Z', 'נתוני דוגמה', '2026-10-28T09:00:00.000Z', 'נתוני דוגמה'),
  ('q-tiles-2', 'area-tiles', 'sup-tiles-2', 12500000, 'excl', '2026-11-02', '2026-12-31', 'פורצלן 60×120, כולל חומר ופאנלים', 'open', NULL, NULL, '2026-11-02T09:00:00.000Z', 'נתוני דוגמה', '2026-11-02T09:00:00.000Z', 'נתוני דוגמה'),
  ('q-carpentry', 'area-carpentry', 'sup-carpentry', 9600000, 'excl', '2026-11-03', '2026-12-03', 'דלפק קופה, מדפי תצוגה', 'open', NULL, NULL, '2026-11-03T09:00:00.000Z', 'נתוני דוגמה', '2026-11-03T09:00:00.000Z', 'נתוני דוגמה');

INSERT INTO change_orders (id, work_area_id, description, amount, vat_mode, date, status, created_at, created_by, updated_at, updated_by) VALUES
  ('co-plumb-1', 'area-plumb', 'נקודת מים נוספת למטבחון', 450000, 'excl', '2026-10-15', 'approved', '2026-10-15T09:00:00.000Z', 'נתוני דוגמה', '2026-10-15T09:00:00.000Z', 'נתוני דוגמה'),
  ('co-elec-1', 'area-elec', 'תאורת חלון ראווה', 600000, 'excl', '2026-11-04', 'pending', '2026-11-04T09:00:00.000Z', 'נתוני דוגמה', '2026-11-04T09:00:00.000Z', 'נתוני דוגמה');

INSERT INTO expenses (id, category, description, payee, estimate_amount, estimate_vat, actual_amount, actual_vat, notes, created_at, created_by, updated_at, updated_by) VALUES
  ('exp-permit', 'permit', 'אגרת היתר שיפוץ', 'העירייה', 900000, 'exempt', 820000, 'exempt', NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('exp-insurance', 'insurance', 'ביטוח עבודות קבלניות', 'חברת הביטוח', 650000, 'exempt', NULL, 'exempt', NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('exp-design', 'consultant', 'אדריכלית ועיצוב', 'סטודיו לעיצוב', 2500000, 'excl', 2800000, 'excl', NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('exp-grid', 'fee', 'הגדלת חיבור חשמל', 'חברת החשמל', 350000, 'exempt', NULL, 'exempt', NULL, '2026-10-01T09:00:00.000Z', 'נתוני דוגמה', '2026-10-01T09:00:00.000Z', 'נתוני דוגמה');

INSERT INTO payments (id, work_area_id, expense_id, amount, vat_mode, date, status, method, reference, notes, created_at, created_by, updated_at, updated_by) VALUES
  ('pay-elec-1', 'area-elec', NULL, 3000000, 'incl', '2026-10-05', 'paid', 'transfer', '1021', 'מקדמה', '2026-10-05T09:00:00.000Z', 'נתוני דוגמה', '2026-10-05T09:00:00.000Z', 'נתוני דוגמה'),
  ('pay-elec-2', 'area-elec', NULL, 2500000, 'incl', '2026-11-20', 'planned', 'transfer', NULL, 'אחרי סיום שלב ב׳', '2026-11-01T09:00:00.000Z', 'נתוני דוגמה', '2026-11-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('pay-plumb-1', 'area-plumb', NULL, 2000000, 'incl', '2026-10-02', 'paid', 'check', '4410', NULL, '2026-10-02T09:00:00.000Z', 'נתוני דוגמה', '2026-10-02T09:00:00.000Z', 'נתוני דוגמה'),
  ('pay-plumb-2', 'area-plumb', NULL, 1500000, 'incl', '2026-10-25', 'paid', 'check', '4418', NULL, '2026-10-25T09:00:00.000Z', 'נתוני דוגמה', '2026-10-25T09:00:00.000Z', 'נתוני דוגמה'),
  ('pay-plumb-3', 'area-plumb', NULL, 500000, 'incl', '2026-11-02', 'planned', 'check', NULL, NULL, '2026-11-01T09:00:00.000Z', 'נתוני דוגמה', '2026-11-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('pay-gypsum-1', 'area-gypsum', NULL, 3000000, 'incl', '2026-10-20', 'paid', 'transfer', '1035', 'מקדמה', '2026-10-20T09:00:00.000Z', 'נתוני דוגמה', '2026-10-20T09:00:00.000Z', 'נתוני דוגמה'),
  ('pay-permit', NULL, 'exp-permit', 820000, 'exempt', '2026-09-15', 'paid', 'credit', NULL, NULL, '2026-09-15T09:00:00.000Z', 'נתוני דוגמה', '2026-09-15T09:00:00.000Z', 'נתוני דוגמה'),
  ('pay-insurance', NULL, 'exp-insurance', 650000, 'exempt', '2026-11-12', 'planned', 'credit', NULL, NULL, '2026-11-01T09:00:00.000Z', 'נתוני דוגמה', '2026-11-01T09:00:00.000Z', 'נתוני דוגמה'),
  ('pay-design-1', NULL, 'exp-design', 1770000, 'incl', '2026-09-01', 'paid', 'transfer', '0998', NULL, '2026-09-01T09:00:00.000Z', 'נתוני דוגמה', '2026-09-01T09:00:00.000Z', 'נתוני דוגמה');
