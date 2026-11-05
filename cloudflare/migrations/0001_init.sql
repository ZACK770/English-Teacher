-- Same schema as the Python SQLite database so Render data imports 1:1.
CREATE TABLE IF NOT EXISTS active_calls ( 
  call_id TEXT PRIMARY KEY, 
  profile_id TEXT NOT NULL, 
  owner_id TEXT NOT NULL, 
  acquired_at REAL NOT NULL, 
  lease_expires_at REAL NOT NULL 
  );
CREATE TABLE IF NOT EXISTS api_quota ( 
  month TEXT NOT NULL, api TEXT NOT NULL, used INTEGER NOT NULL, 
  PRIMARY KEY (month, api));
CREATE TABLE IF NOT EXISTS bot_versions ( 
  id INTEGER PRIMARY KEY AUTOINCREMENT, 
  bot_id TEXT NOT NULL, 
  version INTEGER NOT NULL, 
  settings_json TEXT NOT NULL, 
  created_at TEXT NOT NULL, 
  FOREIGN KEY(bot_id) REFERENCES bots(id), 
  UNIQUE(bot_id, version) 
  );
CREATE TABLE IF NOT EXISTS bots ( 
  id TEXT PRIMARY KEY, 
  label TEXT NOT NULL, 
  role TEXT NOT NULL, 
  description TEXT NOT NULL DEFAULT '', 
  audience TEXT NOT NULL DEFAULT 'general', 
  channel_id TEXT, 
  enabled INTEGER NOT NULL DEFAULT 1, 
  active_version INTEGER NOT NULL DEFAULT 0, 
  created_at TEXT NOT NULL, 
  updated_at TEXT NOT NULL 
  , phone_enabled INTEGER NOT NULL DEFAULT 0, web_enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS call_customers ( 
  call_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, 
  bot_id TEXT NOT NULL, channel TEXT NOT NULL, 
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS console_audit ( 
  id INTEGER PRIMARY KEY, action TEXT NOT NULL, 
  entity_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS console_records ( 
  kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, 
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, 
  PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS console_settings ( 
  id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversation_turns ( 
  id INTEGER PRIMARY KEY AUTOINCREMENT, 
  created_at TEXT NOT NULL, 
  profile_id TEXT NOT NULL, 
  call_id TEXT NOT NULL, 
  direction TEXT NOT NULL, 
  text TEXT NOT NULL, 
  metadata_json TEXT NOT NULL DEFAULT '{}' 
  );
CREATE TABLE IF NOT EXISTS customer_phones ( 
  phone TEXT PRIMARY KEY, customer_id TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS diagnostic_events ( 
  id INTEGER PRIMARY KEY AUTOINCREMENT, 
  created_at TEXT NOT NULL, 
  profile_id TEXT NOT NULL, 
  call_id TEXT NOT NULL, 
  event_type TEXT NOT NULL, 
  details_json TEXT NOT NULL 
  );
CREATE TABLE IF NOT EXISTS latency_events ( 
  id INTEGER PRIMARY KEY AUTOINCREMENT, 
  created_at TEXT NOT NULL, 
  profile_id TEXT NOT NULL, 
  call_id TEXT NOT NULL, 
  event_name TEXT NOT NULL, 
  since_call_start_ms REAL NOT NULL, 
  since_previous_ms REAL NOT NULL, 
  details_json TEXT NOT NULL DEFAULT '{}' 
  );
CREATE TABLE IF NOT EXISTS narration_audio ( 
  narration_id TEXT PRIMARY KEY, text_hash TEXT NOT NULL, 
  wav BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_issues ( 
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, 
  kind TEXT NOT NULL, message TEXT NOT NULL, 
  status TEXT NOT NULL DEFAULT 'open', 
  created_at TEXT NOT NULL, resolved_at TEXT, 
  resolution TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS payment_orders ( 
  id TEXT PRIMARY KEY, call_id TEXT NOT NULL UNIQUE, 
  customer_id TEXT NOT NULL, package_id TEXT NOT NULL, 
  snapshot TEXT NOT NULL, amount_agorot INTEGER NOT NULL, 
  vat_rate REAL NOT NULL, state TEXT NOT NULL, 
  confirmation TEXT NOT NULL DEFAULT '', 
  transaction_id TEXT UNIQUE, receipt_id TEXT, 
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_sync ( 
  action TEXT PRIMARY KEY, last_id INTEGER NOT NULL DEFAULT 0, 
  attempted_at REAL NOT NULL DEFAULT 0, completed_at TEXT, 
  last_error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS portal_tokens ( 
  token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL, 
  expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prompt_snapshots ( 
  id INTEGER PRIMARY KEY AUTOINCREMENT, 
  created_at TEXT NOT NULL, 
  profile_id TEXT NOT NULL, 
  call_id TEXT NOT NULL UNIQUE, 
  bot_version INTEGER NOT NULL DEFAULT 0, 
  fingerprint TEXT NOT NULL, 
  system_instruction TEXT NOT NULL, 
  opening_message TEXT NOT NULL, 
  history_context TEXT NOT NULL, 
  setup_json TEXT NOT NULL 
  );
CREATE TABLE IF NOT EXISTS sales_receipts ( 
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, 
  package_id TEXT NOT NULL, product TEXT NOT NULL, 
  reference TEXT NOT NULL UNIQUE, amount_ils REAL NOT NULL, 
  vat_rate REAL NOT NULL, minutes INTEGER NOT NULL, 
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions ( 
  id INTEGER PRIMARY KEY AUTOINCREMENT, 
  student_id TEXT NOT NULL, 
  call_id TEXT NOT NULL UNIQUE, 
  started_at TEXT NOT NULL, 
  ended_at TEXT NOT NULL, 
  duration_seconds INTEGER NOT NULL, 
  learner_turns INTEGER NOT NULL, 
  tutor_turns INTEGER NOT NULL, 
  observations_json TEXT NOT NULL, 
  transcript_json TEXT 
  , summary_he TEXT NOT NULL DEFAULT '', success_he TEXT NOT NULL DEFAULT '', next_step_he TEXT NOT NULL DEFAULT '', points INTEGER NOT NULL DEFAULT 0, input_text_tokens INTEGER NOT NULL DEFAULT 0, input_audio_tokens INTEGER NOT NULL DEFAULT 0, output_text_tokens INTEGER NOT NULL DEFAULT 0, output_audio_tokens INTEGER NOT NULL DEFAULT 0, thoughts_tokens INTEGER NOT NULL DEFAULT 0, estimated_cost_usd REAL NOT NULL DEFAULT 0, cost_basis TEXT NOT NULL DEFAULT 'none', model TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS tutor_profile_settings ( 
  profile_id TEXT PRIMARY KEY, 
  settings_json TEXT NOT NULL, 
  updated_at TEXT NOT NULL 
  );
CREATE TABLE IF NOT EXISTS tutor_settings ( 
  id INTEGER PRIMARY KEY CHECK (id = 1), 
  settings_json TEXT NOT NULL, 
  updated_at TEXT NOT NULL 
  );
CREATE TABLE IF NOT EXISTS usage_allocations ( 
  call_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, 
  product TEXT NOT NULL, receipt_id TEXT, 
  reserved_seconds REAL NOT NULL, billed_seconds REAL, 
  created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bot_versions_bot 
  ON bot_versions(bot_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_diagnostics_profile_created 
  ON diagnostic_events(profile_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_latency_call 
  ON latency_events(call_id, id);
CREATE INDEX IF NOT EXISTS idx_prompt_snapshots_profile 
  ON prompt_snapshots(profile_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_student_started 
  ON sessions(student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_turns_call 
  ON conversation_turns(call_id, id);
