-- Files attached to quotes (PDF and images). The bytes live in the private R2 bucket
-- under r2_key; this table holds the details and the link to the quote.
CREATE TABLE quote_files (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL
    CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size INTEGER NOT NULL CHECK (size > 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX quote_files_quote ON quote_files (quote_id);

-- Replaced by quote_files (a quote can have several files). Never used before this migration.
ALTER TABLE quotes DROP COLUMN file_key;
ALTER TABLE quotes DROP COLUMN file_name;
