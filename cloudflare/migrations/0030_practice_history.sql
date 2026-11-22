-- Rebuild from saved school calls, not from the time this feature was deployed.
-- Israel's rules since 2013: DST starts on the Friday before March's last Sunday
-- at 00:00 UTC, and ends at 23:00 UTC before October's last Sunday. All service
-- history is newer than 2013. SQLite has no IANA timezone database.
WITH lessons AS (
  SELECT s.student_id AS customer_id, MAX(0, s.duration_seconds) AS seconds,
    datetime(s.started_at) AS utc_at, strftime('%Y', s.started_at) AS year,
    strftime('%Y-%m-%dT%H:%M:%fZ', s.started_at) AS started_at
  FROM sessions s
  JOIN call_customers c ON c.call_id=s.call_id
  JOIN bots b ON b.id=c.bot_id
  WHERE b.role='teacher' AND substr(s.student_id,1,10)<>'anonymous-'
    AND datetime(s.started_at) IS NOT NULL
), days AS (
  SELECT customer_id, seconds, started_at,
    date(utc_at, CASE
      WHEN utc_at >= datetime(year || '-04-01', 'weekday 0', '-9 days')
       AND utc_at < datetime(year || '-11-01', 'weekday 0', '-7 days', '-1 hour')
      THEN '+3 hours' ELSE '+2 hours' END) AS day
  FROM lessons
)
INSERT INTO practice_days(customer_id, day, seconds, calls, first_at, last_at)
SELECT customer_id, day, SUM(seconds), COUNT(*), MIN(started_at), MAX(started_at)
FROM days GROUP BY customer_id, day
ON CONFLICT(customer_id,day) DO UPDATE SET seconds=excluded.seconds,
  calls=excluded.calls, first_at=excluded.first_at, last_at=excluded.last_at;
