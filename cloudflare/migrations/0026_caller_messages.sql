CREATE TABLE caller_messages (
  phone TEXT PRIMARY KEY,
  narration_id TEXT NOT NULL,
  audio_hash TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  inbound_enabled INTEGER NOT NULL DEFAULT 0,
  outbound_extension TEXT,
  outbound_until INTEGER NOT NULL DEFAULT 0,
  playback_call_id TEXT,
  playback_token TEXT UNIQUE,
  playback_until INTEGER NOT NULL DEFAULT 0,
  played_at TEXT
);
