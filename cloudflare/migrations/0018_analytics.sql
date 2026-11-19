CREATE TABLE analytics_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  ts TEXT NOT NULL,
  origin TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer TEXT NOT NULL,
  first_touch TEXT NOT NULL,
  last_touch TEXT NOT NULL,
  value REAL,
  currency TEXT,
  customer_id TEXT,
  order_id TEXT,
  reference TEXT,
  meta TEXT NOT NULL
);
CREATE INDEX analytics_campaign_time ON analytics_events(ts,event,origin);
CREATE TABLE analytics_attribution (
  kind TEXT NOT NULL,
  reference TEXT NOT NULL,
  attribution TEXT NOT NULL,
  PRIMARY KEY(kind,reference)
);
CREATE TABLE analytics_rate_limits (
  key TEXT PRIMARY KEY,
  expires TEXT NOT NULL,
  count INTEGER NOT NULL
);
