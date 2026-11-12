CREATE TABLE navigation_devices (
  device_id TEXT PRIMARY KEY,
  traccar_device_id INTEGER NOT NULL UNIQUE,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  last_received_at_ms INTEGER,
  last_report_at_ms INTEGER,
  last_report_valid INTEGER CHECK(last_report_valid IN (0,1))
);

CREATE TABLE navigation_assignments (
  customer_id TEXT PRIMARY KEY REFERENCES customer_phones(customer_id),
  device_id TEXT NOT NULL REFERENCES navigation_devices(device_id),
  updated_at TEXT NOT NULL
);

CREATE TABLE navigation_positions (
  device_id TEXT PRIMARY KEY REFERENCES navigation_devices(device_id) ON DELETE CASCADE,
  source_position_id INTEGER NOT NULL,
  fix_at_ms INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL,
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  speed_mps REAL NOT NULL CHECK(speed_mps >= 0),
  heading REAL CHECK(heading >= 0 AND heading <= 360),
  accuracy_m REAL CHECK(accuracy_m > 0)
);
