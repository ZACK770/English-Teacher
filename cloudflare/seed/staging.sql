-- Synthetic data for the staging sandbox only. Never run against production.
INSERT OR REPLACE INTO console_records(kind,id,body,created_at,updated_at) VALUES
 ('customers','demo-1','{"name":"לקוח הדגמה א","phone":"0500000001","source":"staging","notes":""}','2026-11-01T08:00:00+00:00','2026-11-01T08:00:00+00:00'),
 ('customers','demo-2','{"name":"לקוח הדגמה ב","phone":"0500000002","source":"staging","notes":""}','2026-11-02T08:00:00+00:00','2026-11-02T08:00:00+00:00');
INSERT OR REPLACE INTO customer_phones(phone,customer_id) VALUES ('0500000001','demo-1'),('0500000002','demo-2');
INSERT OR REPLACE INTO customers(id,name,primary_phone,status,source,city,notes,created_at,updated_at) VALUES
 ('demo-1','לקוח הדגמה א','0500000001','active','staging','בני ברק','','2026-11-01T08:00:00+00:00','2026-11-01T08:00:00+00:00'),
 ('demo-2','לקוח הדגמה ב','0500000002','lead','staging','ירושלים','','2026-11-02T08:00:00+00:00','2026-11-02T08:00:00+00:00');
INSERT OR REPLACE INTO plans(id,name,product,billing,price_agorot,included_minutes,validity_days,includes_device,active,description,created_at,updated_at) VALUES
 ('nav-monthly','ניווט קולי חודשי','navigation','monthly',4900,NULL,NULL,0,1,'ניווט בשיחה ללא הגבלה','2026-11-01T08:00:00+00:00','2026-11-01T08:00:00+00:00'),
 ('nav-kit','ערכת איתור + חודש ראשון','navigation','one_time',29000,NULL,30,1,1,'מכשיר מוגדר וסים','2026-11-01T08:00:00+00:00','2026-11-01T08:00:00+00:00');
INSERT OR REPLACE INTO subscriptions(id,customer_id,plan_id,status,price_agorot,started_at,current_period_end,cancelled_at,notes,created_at,updated_at) VALUES
 ('sub-demo-1','demo-1','nav-monthly','active',4900,'2026-11-01T08:00:00+00:00','2026-12-01T08:00:00+00:00',NULL,'','2026-11-01T08:00:00+00:00','2026-11-01T08:00:00+00:00');
INSERT OR REPLACE INTO sim_cards(iccid,carrier,msisdn,plan_name,data_mb_month,monthly_cost_agorot,status,activated_at,notes,created_at,updated_at) VALUES
 ('8997200000000000001','019','0550000001','SIM Data 2GB',2048,1200,'active','2026-11-01T08:00:00+00:00','','2026-11-01T08:00:00+00:00','2026-11-01T08:00:00+00:00');
INSERT OR REPLACE INTO navigation_devices(device_id,traccar_device_id,label,enabled,created_at,last_received_at_ms,last_report_at_ms,last_report_valid,model,imei,sim_iccid,inventory_status,sold_at,notes) VALUES
 ('demo-tracker',900001,'רכב הדגמה',1,'2026-11-01T08:00:00+00:00',1794326400000,1794326400000,1,'ST-904L-E','000000000000001','8997200000000000001','in_service','2026-11-01T08:00:00+00:00','');
INSERT OR REPLACE INTO navigation_assignments(customer_id,device_id,updated_at) VALUES ('demo-1','demo-tracker','2026-11-01T08:00:00+00:00');
INSERT OR REPLACE INTO navigation_positions(device_id,source_position_id,fix_at_ms,received_at_ms,latitude,longitude,speed_mps,heading,accuracy_m) VALUES
 ('demo-tracker',1,1794326400000,1794326400500,32.0853,34.8338,13.9,90,8);
INSERT OR REPLACE INTO navigation_destinations(id,customer_id,label,address,created_at,updated_at) VALUES
 ('dest-demo-1','demo-1','בית','רבי עקיבא 1, בני ברק','2026-11-01T08:00:00+00:00','2026-11-01T08:00:00+00:00');
INSERT OR REPLACE INTO navigation_trips(id,customer_id,device_id,destination_label,destination_address,status,eta_at_ms,created_at_ms,updated_at_ms,ended_at_ms,last_call_id,revision) VALUES
 ('trip-demo-1','demo-1','demo-tracker','בית','רבי עקיבא 1, בני ברק','completed',1794241200000,1794240000000,1794241300000,1794241300000,'call-demo-1',1);
INSERT OR REPLACE INTO call_customers(call_id,customer_id,bot_id,channel,created_at) VALUES ('call-demo-1','demo-1','navigation','phone','2026-11-11T13:20:00+00:00');
INSERT INTO conversation_turns(created_at,profile_id,call_id,direction,text) VALUES
 ('2026-11-11T13:20:05+00:00','navigation','call-demo-1','caller','תיקח אותי הביתה'),
 ('2026-11-11T13:20:07+00:00','navigation','call-demo-1','bot','בעוד 400 מטר פנה ימינה לרחוב ז׳בוטינסקי.');
INSERT OR REPLACE INTO navigation_call_costs(call_id,profile_id,computed_at,summary_json) VALUES
 ('call-demo-1','navigation','2026-11-11T13:40:00+00:00','{"status":"complete","known_subtotal_ils":0.41,"known_subtotal_usd":0.11,"basis":"synthetic"}');
INSERT OR REPLACE INTO invoices(id,customer_id,subscription_id,description,amount_agorot,vat_rate,status,provider,provider_reference,sales_receipt_id,issued_at,paid_at,created_at) VALUES
 ('inv-demo-1','demo-1','sub-demo-1','ניווט קולי – נובמבר',4900,0.18,'paid','manual',NULL,NULL,'2026-11-01T08:00:00+00:00','2026-11-01T08:05:00+00:00','2026-11-01T08:00:00+00:00');
