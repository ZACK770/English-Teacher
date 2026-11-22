ALTER TABLE standing_orders ADD COLUMN last_refusal_at TEXT;
ALTER TABLE sales_receipts ADD COLUMN payment_reversed_at TEXT;
CREATE INDEX standing_orders_entitlement ON standing_orders(entitlement_id);
