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
  term_months INTEGER CHECK(term_months IN (6,12)),
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
INSERT INTO subscriptions_new(id,customer_id,plan_id,status,price_agorot,started_at,current_period_end,cancelled_at,notes,created_at,updated_at)
SELECT id,customer_id,plan_id,status,price_agorot,started_at,current_period_end,cancelled_at,notes,created_at,updated_at FROM subscriptions;
CREATE TABLE subscription_invoice_links AS SELECT id,subscription_id FROM invoices WHERE subscription_id IS NOT NULL;
UPDATE invoices SET subscription_id=NULL WHERE subscription_id IS NOT NULL;
DROP TABLE subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;
UPDATE invoices SET subscription_id=(SELECT subscription_id FROM subscription_invoice_links l WHERE l.id=invoices.id) WHERE id IN (SELECT id FROM subscription_invoice_links);
DROP TABLE subscription_invoice_links;
CREATE INDEX idx_subscriptions_customer ON subscriptions(customer_id,created_at DESC);
ALTER TABLE plans ADD COLUMN domains_json TEXT NOT NULL DEFAULT '[]';
UPDATE plans SET domains_json='[{"domain":"everyday","levels":["beginner"]}]' WHERE id='school-foundations';
UPDATE plans SET domains_json='[{"domain":"everyday","levels":["beginner"]},{"domain":"everyday","levels":["intermediate","fluent"]}]' WHERE id='school-mastery';
UPDATE subscriptions SET
  monthly_minutes=COALESCE((SELECT included_minutes FROM plans WHERE id=subscriptions.plan_id),0),
  current_period_start=started_at,
  current_period_end=COALESCE(current_period_end,
    strftime('%Y-%m-',started_at,'start of month','+1 month') ||
    printf('%02d',MIN(CAST(strftime('%d',started_at) AS INTEGER),CAST(strftime('%d',started_at,'start of month','+2 months','-1 day') AS INTEGER))) ||
    strftime('T%H:%M:%f+00:00',started_at)),
  pause_year_start=started_at,
  domains_json=COALESCE((SELECT domains_json FROM plans WHERE id=subscriptions.plan_id),'[]');
ALTER TABLE sales_receipts ADD COLUMN subscription_id TEXT REFERENCES subscriptions(id);
ALTER TABLE sales_receipts ADD COLUMN valid_from TEXT;
CREATE INDEX idx_receipts_subscription ON sales_receipts(subscription_id,expires_at);
ALTER TABLE standing_orders ADD COLUMN entitlement_id TEXT REFERENCES subscriptions(id);
ALTER TABLE payment_orders ADD COLUMN entitlement_id TEXT REFERENCES subscriptions(id);
CREATE TABLE subscription_members (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  added_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY(subscription_id,customer_id)
);
CREATE TABLE subscription_renewals (
  reference TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  period_start TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(subscription_id,period_start)
);
