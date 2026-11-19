-- Typed platform tables for the web platform and external AI clients.
-- console_records stays the compatibility store; customers/plans are mirrored by BusinessStore.save.

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  primary_phone TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('lead','active','suspended','closed')),
  source TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO customers(id,name,primary_phone,status,source,city,notes,created_at,updated_at)
SELECT c.id, COALESCE(json_extract(c.body,'$.name'),''),
  (SELECT p.phone FROM customer_phones p WHERE p.customer_id=c.id),
  'active', COALESCE(json_extract(c.body,'$.source'),''), '', COALESCE(json_extract(c.body,'$.notes'),''),
  c.created_at, c.updated_at
FROM console_records c WHERE c.kind='customers';

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  product TEXT NOT NULL CHECK(product IN ('navigation','school','translator')),
  billing TEXT NOT NULL CHECK(billing IN ('prepaid','monthly','yearly','one_time')),
  price_agorot INTEGER NOT NULL CHECK(price_agorot >= 0),
  included_minutes INTEGER CHECK(included_minutes IS NULL OR included_minutes >= 0),
  validity_days INTEGER CHECK(validity_days IS NULL OR validity_days > 0),
  includes_device INTEGER NOT NULL DEFAULT 0 CHECK(includes_device IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO plans(id,name,product,billing,price_agorot,included_minutes,validity_days,includes_device,active,description,created_at,updated_at)
SELECT id, COALESCE(json_extract(body,'$.name'),id),
  CASE WHEN json_extract(body,'$.product') IN ('school','translator') THEN json_extract(body,'$.product') ELSE 'school' END,
  'prepaid', CAST(ROUND(COALESCE(json_extract(body,'$.price_ils'),0)*100) AS INTEGER),
  json_extract(body,'$.minutes'), json_extract(body,'$.validity_days'), 0,
  CASE WHEN json_extract(body,'$.active') THEN 1 ELSE 0 END, '', created_at, updated_at
FROM console_records WHERE kind='packages';

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK(status IN ('trial','active','past_due','cancelled','expired')),
  price_agorot INTEGER NOT NULL CHECK(price_agorot >= 0),
  started_at TEXT NOT NULL,
  current_period_end TEXT,
  cancelled_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sim_cards (
  iccid TEXT PRIMARY KEY,
  carrier TEXT NOT NULL DEFAULT '',
  msisdn TEXT NOT NULL DEFAULT '',
  plan_name TEXT NOT NULL DEFAULT '',
  data_mb_month INTEGER CHECK(data_mb_month IS NULL OR data_mb_month >= 0),
  monthly_cost_agorot INTEGER CHECK(monthly_cost_agorot IS NULL OR monthly_cost_agorot >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('stock','active','suspended','cancelled')),
  activated_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE navigation_devices ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE navigation_devices ADD COLUMN imei TEXT NOT NULL DEFAULT '';
ALTER TABLE navigation_devices ADD COLUMN sim_iccid TEXT REFERENCES sim_cards(iccid);
ALTER TABLE navigation_devices ADD COLUMN inventory_status TEXT NOT NULL DEFAULT 'in_service'
  CHECK(inventory_status IN ('stock','in_service','returned','faulty','retired'));
ALTER TABLE navigation_devices ADD COLUMN sold_at TEXT;
ALTER TABLE navigation_devices ADD COLUMN notes TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  subscription_id TEXT REFERENCES subscriptions(id),
  description TEXT NOT NULL DEFAULT '',
  amount_agorot INTEGER NOT NULL CHECK(amount_agorot >= 0),
  vat_rate REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('open','paid','void','refunded')),
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_reference TEXT,
  sales_receipt_id TEXT UNIQUE,
  issued_at TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id, issued_at DESC);

INSERT OR IGNORE INTO invoices(id,customer_id,description,amount_agorot,vat_rate,status,provider,provider_reference,sales_receipt_id,issued_at,paid_at,created_at)
SELECT 'inv-' || r.id, r.customer_id, r.product || ' · ' || r.minutes || ' דקות',
  CAST(ROUND(r.amount_ils*100) AS INTEGER), r.vat_rate, 'paid', 'nedarim', r.reference, r.id, r.created_at, r.created_at, r.created_at
FROM sales_receipts r WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id=r.customer_id);

CREATE TABLE IF NOT EXISTS app_login_codes (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id),
  code_hash TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  expires_at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_customer ON app_sessions(customer_id);
