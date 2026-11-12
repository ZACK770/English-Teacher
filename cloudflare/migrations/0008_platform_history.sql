-- Driven path per device (every accepted fix), customer device mode and per-customer call settings.
CREATE TABLE IF NOT EXISTS navigation_position_history (
  device_id TEXT NOT NULL REFERENCES navigation_devices(device_id) ON DELETE CASCADE,
  fix_at_ms INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_mps REAL NOT NULL,
  heading REAL,
  accuracy_m REAL,
  PRIMARY KEY(device_id, fix_at_ms)
) WITHOUT ROWID;

ALTER TABLE customers ADD COLUMN device_mode TEXT NOT NULL DEFAULT 'none' CHECK(device_mode IN ('none','kit','own'));

CREATE TABLE IF NOT EXISTS customer_settings (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id),
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
