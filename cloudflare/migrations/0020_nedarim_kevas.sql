CREATE TABLE IF NOT EXISTS nedarim_kevas (
  keva_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  mail TEXT NOT NULL DEFAULT '',
  amount TEXT NOT NULL DEFAULT '',
  groupe TEXT NOT NULL DEFAULT '',
  comments TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  itra TEXT NOT NULL DEFAULT '',
  success TEXT NOT NULL DEFAULT '',
  error_text TEXT NOT NULL DEFAULT '',
  creation_date TEXT NOT NULL DEFAULT '',
  next_date TEXT NOT NULL DEFAULT '',
  customer_id TEXT,
  raw TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
