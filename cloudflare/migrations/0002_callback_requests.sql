CREATE TABLE IF NOT EXISTS callback_requests (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  for_whom TEXT NOT NULL,
  goal TEXT NOT NULL,
  timing TEXT NOT NULL,
  preferred_time TEXT,
  source TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_ref TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS callback_requests_phone ON callback_requests (phone, created_at);
CREATE INDEX IF NOT EXISTS callback_requests_status ON callback_requests (status, created_at);
