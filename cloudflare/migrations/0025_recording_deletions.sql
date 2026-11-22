CREATE TABLE recording_deletions (
  r2_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE INDEX recording_deletions_created ON recording_deletions(created_at);
