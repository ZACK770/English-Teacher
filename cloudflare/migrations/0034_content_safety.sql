CREATE TABLE content_safety_holds (
  subject_id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason IN ('tutor', 'learner', 'critical')),
  created_ms INTEGER NOT NULL,
  alert_state TEXT CHECK (alert_state IN ('pending', 'sending', 'accepted', 'failed')),
  CHECK ((subject_id = 'teachers') = (reason = 'critical'))
);

CREATE TABLE content_safety_strikes (
  event_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);

CREATE INDEX content_safety_strikes_customer ON content_safety_strikes (customer_id, created_ms);
CREATE INDEX content_safety_strikes_expiry ON content_safety_strikes (created_ms);
