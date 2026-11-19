CREATE TABLE IF NOT EXISTS navigation_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  model TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  usage_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_navigation_usage_call ON navigation_usage_events(call_id, id);
CREATE TABLE IF NOT EXISTS navigation_call_costs (
  call_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  summary_json TEXT NOT NULL
);
