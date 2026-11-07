-- Money columns are integer agorot (1 ILS = 100).
-- VAT columns: 'incl' | 'excl' | 'exempt'. Dates are ISO strings (YYYY-MM-DD).

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project_name TEXT NOT NULL,
  total_budget INTEGER NOT NULL DEFAULT 0,
  budget_vat TEXT NOT NULL DEFAULT 'excl' CHECK (budget_vat IN ('incl', 'excl')),
  reserve_amount INTEGER NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 18,
  display_basis TEXT NOT NULL DEFAULT 'excl' CHECK (display_basis IN ('incl', 'excl')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO settings (id, project_name, updated_at, updated_by)
VALUES (1, 'שיפוץ החנות', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system');

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  tax_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE work_areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'collecting_quotes', 'supplier_selected', 'in_progress', 'done')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  estimate_amount INTEGER,
  estimate_vat TEXT NOT NULL DEFAULT 'excl' CHECK (estimate_vat IN ('incl', 'excl', 'exempt')),
  selected_quote_id TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  work_area_id TEXT NOT NULL REFERENCES work_areas (id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers (id),
  amount INTEGER NOT NULL,
  vat_mode TEXT NOT NULL CHECK (vat_mode IN ('incl', 'excl', 'exempt')),
  received_date TEXT,
  valid_until TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'rejected')),
  file_key TEXT,
  file_name TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX quotes_work_area ON quotes (work_area_id);
CREATE INDEX quotes_supplier ON quotes (supplier_id);

CREATE TABLE change_orders (
  id TEXT PRIMARY KEY,
  work_area_id TEXT NOT NULL REFERENCES work_areas (id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,
  vat_mode TEXT NOT NULL CHECK (vat_mode IN ('incl', 'excl', 'exempt')),
  date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX change_orders_work_area ON change_orders (work_area_id);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('fee', 'insurance', 'permit', 'consultant', 'other')),
  description TEXT NOT NULL,
  payee TEXT,
  estimate_amount INTEGER,
  estimate_vat TEXT NOT NULL DEFAULT 'excl' CHECK (estimate_vat IN ('incl', 'excl', 'exempt')),
  actual_amount INTEGER,
  actual_vat TEXT NOT NULL DEFAULT 'excl' CHECK (actual_vat IN ('incl', 'excl', 'exempt')),
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- Payments are financial records: an area or expense that has payments cannot be deleted.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  work_area_id TEXT REFERENCES work_areas (id),
  expense_id TEXT REFERENCES expenses (id),
  amount INTEGER NOT NULL,
  vat_mode TEXT NOT NULL CHECK (vat_mode IN ('incl', 'excl', 'exempt')),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid', 'planned')),
  method TEXT CHECK (method IN ('transfer', 'check', 'credit', 'cash', 'other')),
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CHECK ((work_area_id IS NULL) <> (expense_id IS NULL))
);
CREATE INDEX payments_work_area ON payments (work_area_id);
CREATE INDEX payments_expense ON payments (expense_id);
CREATE INDEX payments_date ON payments (date);
