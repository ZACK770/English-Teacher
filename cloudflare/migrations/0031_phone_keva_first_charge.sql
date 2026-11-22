CREATE TABLE phone_keva_first_charges (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES payment_orders(id),
  keva_id TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('checking','charging','charged','declined','unknown','skipped')),
  transaction_id TEXT,
  confirmation TEXT,
  period_start TEXT,
  next_date TEXT,
  created_at TEXT NOT NULL
);
