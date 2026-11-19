CREATE TABLE navigation_trips (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customer_phones(customer_id),
  device_id TEXT NOT NULL REFERENCES navigation_devices(device_id),
  destination_label TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
  eta_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  last_call_id TEXT,
  connected_at_ms INTEGER,
  disconnected_at_ms INTEGER,
  call_lease_until_ms INTEGER,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  CHECK(eta_at_ms IS NULL OR eta_at_ms > created_at_ms),
  CHECK((status = 'active' AND ended_at_ms IS NULL) OR (status <> 'active' AND ended_at_ms IS NOT NULL))
);

CREATE UNIQUE INDEX idx_navigation_trips_active ON navigation_trips(customer_id) WHERE status = 'active';
CREATE UNIQUE INDEX idx_navigation_trips_device_active ON navigation_trips(device_id) WHERE status = 'active';
CREATE INDEX idx_navigation_trips_customer ON navigation_trips(customer_id, created_at_ms DESC);
