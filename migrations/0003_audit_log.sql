-- Change history: one row per create, update or delete, written in the same batch as the change.
-- actor is the email from the identity verified by Cloudflare Access.
-- changes (JSON): for create/delete a snapshot of the item's fields; for update {field: [before, after]}.
-- refs (JSON): names of items referred to by id (area, supplier, expense) as they were at the time.
-- No secrets and no file contents are stored here (files: name, type and size only).
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity TEXT NOT NULL
    CHECK (entity IN ('settings', 'supplier', 'work_area', 'quote', 'quote_file', 'change_order', 'expense', 'payment')),
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL,
  changes TEXT NOT NULL,
  refs TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at ON audit_log (at);
CREATE INDEX audit_log_actor_at ON audit_log (actor, at);
