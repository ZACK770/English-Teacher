CREATE TABLE ivr_voicemails (
  id TEXT PRIMARY KEY NOT NULL,
  system_phone TEXT NOT NULL,
  file_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  caller_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  intake_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  fetch_attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  audio_ready INTEGER NOT NULL DEFAULT 0,
  transcription_day TEXT,
  reserved_seconds INTEGER,
  transcript TEXT,
  UNIQUE (system_phone, file_id)
);

CREATE INDEX ivr_voicemails_intake ON ivr_voicemails (intake_day);
CREATE INDEX ivr_voicemails_jobs ON ivr_voicemails (status, lease_until);
CREATE INDEX ivr_voicemails_budget ON ivr_voicemails (transcription_day, caller_key);
CREATE INDEX ivr_voicemails_recent ON ivr_voicemails (created_at DESC, id DESC);
