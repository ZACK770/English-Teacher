CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK(username = lower(username)),
  display_name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL CHECK(role IN ('owner', 'staff')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX admin_sessions_user ON admin_sessions(user_id);
CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  ip TEXT,
  detail TEXT
);
CREATE INDEX admin_audit_login ON admin_audit_log(actor, ip, ts);
