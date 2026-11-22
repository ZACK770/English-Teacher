CREATE TABLE practice_days (
  customer_id TEXT NOT NULL, day TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
  PRIMARY KEY(customer_id, day)
);
CREATE INDEX practice_days_day ON practice_days(day, customer_id);
CREATE TABLE practice_reminders (
  customer_id TEXT PRIMARY KEY, time_local TEXT NOT NULL,
  weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5]', active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX practice_reminders_active ON practice_reminders(active, time_local);
CREATE TABLE practice_reminder_events (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, day TEXT NOT NULL,
  scheduled_for TEXT NOT NULL, sent_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('sent','failed','skipped_practiced','dry_run')),
  responded_call_id TEXT, responded_at TEXT
);
CREATE INDEX practice_reminder_events_customer ON practice_reminder_events(customer_id, sent_at);
CREATE INDEX practice_reminder_events_schedule ON practice_reminder_events(day, scheduled_for);
UPDATE console_records SET body=json_set(body,
  '$.sessions_per_week', CASE id WHEN 'school-step' THEN 3 ELSE 7 END,
  '$.monthly_minutes', CASE id WHEN 'school-step' THEN 60 WHEN 'school-pace' THEN 200 WHEN 'school-fluent' THEN 300 ELSE 150 END,
  '$.name', CASE id WHEN 'school-step' THEN 'סטארט' WHEN 'school-pace' THEN 'סמול טוק' WHEN 'school-fluent' THEN 'פרו' WHEN 'school-foundations' THEN 'מקס' ELSE 'מאסטר' END)
WHERE kind='packages' AND id IN ('school-step','school-pace','school-fluent','school-foundations','school-mastery');
UPDATE plans SET name=(SELECT json_extract(body,'$.name') FROM console_records WHERE kind='packages' AND console_records.id=plans.id)
WHERE id IN ('school-step','school-pace','school-fluent','school-foundations','school-mastery');
