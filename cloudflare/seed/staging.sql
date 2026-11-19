-- Synthetic data for the staging sandbox only. Never run against production.
INSERT OR REPLACE INTO console_records(kind,id,body,created_at,updated_at) VALUES
 ('customers','demo-1','{"name":"לקוח הדגמה א","phone":"0500000001","source":"staging","notes":""}','2026-11-01T08:00:00+00:00','2026-11-01T08:00:00+00:00'),
 ('customers','demo-2','{"name":"לקוח הדגמה ב","phone":"0500000002","source":"staging","notes":""}','2026-11-02T08:00:00+00:00','2026-11-02T08:00:00+00:00');
INSERT OR REPLACE INTO customer_phones(phone,customer_id) VALUES ('0500000001','demo-1'),('0500000002','demo-2');
INSERT OR REPLACE INTO customers(id,name,primary_phone,status,source,city,notes,created_at,updated_at) VALUES
 ('demo-1','לקוח הדגמה א','0500000001','active','staging','בני ברק','','2026-11-01T08:00:00+00:00','2026-11-01T08:00:00+00:00'),
 ('demo-2','לקוח הדגמה ב','0500000002','lead','staging','ירושלים','','2026-11-02T08:00:00+00:00','2026-11-02T08:00:00+00:00');
