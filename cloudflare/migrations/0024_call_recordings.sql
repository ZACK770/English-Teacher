CREATE TABLE call_recordings (
  call_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX call_recordings_created ON call_recordings(created_at);
CREATE INDEX call_recordings_customer ON call_recordings(customer_id);
