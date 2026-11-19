-- Monthly plans and term tracks become purchasable on the phone line (/3); terms follow the approved menu.
UPDATE console_records SET body=json_set(body,'$.phone_enabled',json('true')),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE kind='packages' AND id IN ('school-step','school-pace','school-fluent','school-foundations','school-mastery');
UPDATE console_records SET body=json_set(body,'$.duration_months',4,'$.validity_days',120,'$.max_installments',6,'$.anchor_price_ils',796) WHERE kind='packages' AND id='school-foundations';
UPDATE console_records SET body=json_set(body,'$.duration_months',6,'$.validity_days',180,'$.max_installments',12,'$.anchor_price_ils',1194) WHERE kind='packages' AND id='school-mastery';
UPDATE plans SET validity_days=120 WHERE id='school-foundations';
UPDATE plans SET validity_days=180 WHERE id='school-mastery';

-- Term tracks are no longer limited to 6 or 12 months.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE subscriptions_new (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK(status IN ('trial','active','paused','past_due','cancelled','expired')),
  price_agorot INTEGER NOT NULL CHECK(price_agorot >= 0),
  started_at TEXT NOT NULL,
  current_period_end TEXT,
  cancelled_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  family_addon_agorot INTEGER NOT NULL DEFAULT 3900,
  term_months INTEGER CHECK(term_months BETWEEN 1 AND 12),
  current_period_start TEXT,
  paused_at TEXT,
  pause_until TEXT,
  resume_status TEXT NOT NULL DEFAULT 'active' CHECK(resume_status IN ('active','past_due')),
  pause_days_used REAL NOT NULL DEFAULT 0,
  pause_year_start TEXT,
  guarantee_status TEXT CHECK(guarantee_status IN ('pending','granted','not_eligible')),
  guarantee_evaluated_at TEXT,
  extension_months INTEGER NOT NULL DEFAULT 0 CHECK(extension_months IN (0,3)),
  domains_json TEXT NOT NULL DEFAULT '[]',
  monthly_minutes INTEGER NOT NULL DEFAULT 0,
  period_number INTEGER NOT NULL DEFAULT 1,
  term_end TEXT
);
-- Rows are re-inserted after the rename so deferred foreign keys of receipts, renewals and members resolve again.
CREATE TABLE subscriptions_copy AS SELECT * FROM subscriptions;
DROP TABLE subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;
INSERT INTO subscriptions(id,customer_id,plan_id,status,price_agorot,started_at,current_period_end,cancelled_at,notes,created_at,updated_at,family_addon_agorot,term_months,current_period_start,paused_at,pause_until,resume_status,pause_days_used,pause_year_start,guarantee_status,guarantee_evaluated_at,extension_months,domains_json,monthly_minutes,period_number,term_end) SELECT id,customer_id,plan_id,status,price_agorot,started_at,current_period_end,cancelled_at,notes,created_at,updated_at,family_addon_agorot,term_months,current_period_start,paused_at,pause_until,resume_status,pause_days_used,pause_year_start,guarantee_status,guarantee_evaluated_at,extension_months,domains_json,monthly_minutes,period_number,term_end FROM subscriptions_copy;
DROP TABLE subscriptions_copy;
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id,created_at DESC);
