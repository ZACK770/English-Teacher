-- Monthly plans charge the full price from the first month (no ₪29 intro).
UPDATE console_records SET body=json_remove(body,'$.first_month_price_ils'), updated_at=strftime('%Y-%m-%dT%H:%M:%f+00:00','now')
WHERE kind='packages' AND id IN ('school-step','school-pace','school-fluent') AND json_extract(body,'$.first_month_price_ils') IS NOT NULL;
