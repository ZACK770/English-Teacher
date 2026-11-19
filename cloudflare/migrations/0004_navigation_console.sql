ALTER TABLE navigation_devices ADD COLUMN battery_level_pct REAL CHECK(battery_level_pct BETWEEN 0 AND 100);
ALTER TABLE navigation_devices ADD COLUMN battery_at_ms INTEGER;
ALTER TABLE navigation_devices ADD COLUMN charging INTEGER CHECK(charging IN (0,1));

CREATE TABLE navigation_destinations (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customer_phones(customer_id),
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_navigation_destinations_customer ON navigation_destinations(customer_id, updated_at DESC);
