ALTER TABLE standing_orders ADD COLUMN previous_monthly_agorot INTEGER;
CREATE TABLE subscription_billing_locks (
  subscription_id TEXT PRIMARY KEY REFERENCES subscriptions(id),
  token TEXT NOT NULL,
  created_at TEXT NOT NULL
);
