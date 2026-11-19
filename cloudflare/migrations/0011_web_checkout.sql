-- Website card checkout through the Nedarim iframe and monthly standing orders (הוראת קבע).
ALTER TABLE payment_orders ADD COLUMN channel TEXT NOT NULL DEFAULT 'phone';
ALTER TABLE payment_orders ADD COLUMN installments INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_orders ADD COLUMN provider_ref TEXT;
ALTER TABLE payment_orders ADD COLUMN subscription_id TEXT;
CREATE TABLE IF NOT EXISTS standing_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  monthly_agorot INTEGER NOT NULL,
  first_order_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  keva_id TEXT UNIQUE,
  provider_ref TEXT,
  next_date TEXT,
  last_charge_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS standing_orders_customer ON standing_orders(customer_id, created_at);
