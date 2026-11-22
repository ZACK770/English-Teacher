INSERT INTO console_records(kind,id,body,created_at,updated_at) VALUES (
  'packages','school-offer-week',
  '{"id":"school-offer-week","name":"חודש היכרות בספיקול","product":"school","billing":"monthly","price_ils":59,"first_month_price_ils":10,"minutes":30,"monthly_minutes":30,"sessions_per_week":3,"validity_days":30,"max_call_minutes":10,"active":true,"phone_enabled":true,"automated_purchase":false,"recommended":false}',
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
