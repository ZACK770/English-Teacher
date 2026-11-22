CREATE TABLE phone_keva_enrollments (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES payment_orders(id),
  phone TEXT NOT NULL,
  keva_id TEXT UNIQUE
);

CREATE UNIQUE INDEX phone_keva_pending_customer ON payment_orders(customer_id)
WHERE channel='phone' AND json_extract(snapshot,'$.billing')='monthly'
AND state IN ('selected','issued','awaiting_settlement');
