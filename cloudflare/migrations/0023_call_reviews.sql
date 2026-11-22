CREATE TABLE call_reviews (
  source TEXT NOT NULL CHECK(source IN ('ai','ivr')),
  call_id TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  profile_id TEXT,
  bot_version INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_after TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','failed','no_transcript','reviewed','rules_only')),
  findings TEXT NOT NULL DEFAULT '[]',
  input_tokens INTEGER,
  output_tokens INTEGER,
  PRIMARY KEY(source, call_id)
);
CREATE INDEX call_reviews_ended ON call_reviews(ended_at);
CREATE INDEX sessions_ended ON sessions(ended_at);
CREATE INDEX diagnostic_events_call ON diagnostic_events(call_id, id);
CREATE INDEX latency_events_closed ON latency_events(created_at, call_id)
  WHERE event_name = 'ai_connection_closed';
CREATE INDEX ivr_events_time ON console_records(created_at)
  WHERE kind = 'ivr-events';
CREATE INDEX ivr_events_call ON console_records(json_extract(body, '$.call_id'), created_at)
  WHERE kind = 'ivr-events';
CREATE TABLE call_review_phone (
  call_id TEXT PRIMARY KEY,
  navigation_seconds INTEGER NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX call_review_phone_time ON call_review_phone(observed_at);
