import { type Env, HttpError, sha256Hex } from "./env";
import { visiblePhone } from "./phone";

type Row = Record<string, any>;
type Removal = { table: string; where: string; args: unknown[] };

export async function resetCustomer(request: Request, env: Env, person: Row, actor?: { role: string; username: string }) {
  if (actor?.role !== "owner") throw new HttpError(403, "רק בעל החשבון רשאי למחוק לקוח");
  const body = await request.json().catch(() => null) as { confirm?: unknown } | null;
  if (body?.confirm !== (person.phone || person.id)) throw new HttpError(400, "האישור אינו תואם. יש להקליד את הטלפון או את מזהה הלקוח כפי שמוצג בכרטיס.");
  const id = person.id;
  const rows = async (query: string, ...args: unknown[]) => (await env.DB.prepare(query).bind(...args).all<Row>()).results;
  if ((await rows("SELECT 1 FROM subscription_members m JOIN subscriptions s ON s.id=m.subscription_id WHERE m.customer_id=? AND s.customer_id<>? LIMIT 1", id, id)).length) throw new HttpError(409, "יש להסיר את הלקוח מהמנוי המשפחתי תחילה");
  if ((await rows("SELECT 1 FROM payment_orders WHERE customer_id=? AND state IN ('issued','awaiting_settlement') LIMIT 1", id)).length) throw new HttpError(409, "לא ניתן למחוק לקוח עם תשלום הממתין לסליקה. יש להמתין להשלמת התשלום או לביטולו.");
  const callRows = await rows(`SELECT call_id FROM call_customers WHERE customer_id=? UNION SELECT call_id FROM sessions WHERE student_id=?
    UNION SELECT call_id FROM usage_allocations WHERE customer_id=? UNION SELECT call_id FROM payment_orders WHERE customer_id=?
    UNION SELECT call_id FROM learning_lessons WHERE customer_id=? UNION SELECT last_call_id FROM navigation_trips WHERE customer_id=?
    UNION SELECT json_extract(body,'$.call_id') FROM console_records WHERE kind IN ('ivr-events','ad-entries','sales-followups') AND json_extract(body,'$.customer_id')=?`, id, id, id, id, id, id, id);
  const callIds = [...new Set(callRows.flatMap(r => r.call_id ? [r.call_id, r.call_id.split("~")[0]] : []))];
  const calls = JSON.stringify(callIds);
  if ((await rows("SELECT 1 FROM active_calls WHERE call_id IN (SELECT value FROM json_each(?)) AND lease_expires_at>? LIMIT 1", calls, Date.now() / 1000)).length) throw new HttpError(409, "לא ניתן למחוק לקוח במהלך שיחה פעילה. יש לסיים את השיחה ולנסות שוב.");
  const subs = JSON.stringify((await rows("SELECT id FROM subscriptions WHERE customer_id=?", id)).map(r => r.id));
  const inSubs = "IN (SELECT value FROM json_each(?))";
  if ((await rows(`SELECT 1 FROM standing_orders WHERE (customer_id=? OR entitlement_id ${inSubs}) AND state<>'cancelled'
    UNION ALL SELECT 1 FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.customer_id=? AND s.status IN ('active','paused','past_due') AND p.billing IN ('monthly','yearly') LIMIT 1`, id, subs, id)).length) throw new HttpError(409, "לא ניתן למחוק לקוח עם הוראת קבע או מנוי מתחדש פעיל. יש לבטל תחילה את החיוב אצל ספק התשלום.");
  const phoneRows = await rows(`SELECT phone FROM customer_phones WHERE customer_id=? UNION SELECT primary_phone AS phone FROM customers WHERE id=?
    UNION SELECT json_extract(body,'$.phone') FROM console_records WHERE (kind='customers' AND id=?) OR (kind='learner-phone-links' AND json_extract(body,'$.customer_id')=?)`, id, id, id, id);
  const otherPhones = await rows("SELECT phone FROM customer_phones WHERE customer_id<>? UNION SELECT primary_phone AS phone FROM customers WHERE id<>?", id, id);
  const conflicting = new Set(otherPhones.map(r => r.phone && visiblePhone(r.phone)).filter(Boolean));
  const phones = [...new Set([...phoneRows.map(r => r.phone), person.phone].filter(Boolean).map(p => visiblePhone(p)).filter(p => p && !conflicting.has(p)))];
  const hashes = await Promise.all(phones.map(p => sha256Hex(p!)));
  const phoneJson = JSON.stringify([...new Set([...phoneRows.map(r => r.phone).filter(p => p && phones.includes(visiblePhone(p))), ...phones, ...phones.filter(p => p!.startsWith("0")).flatMap(p => ["+972" + p!.slice(1), "972" + p!.slice(1)])].filter(Boolean))]);
  const conflictingJson = JSON.stringify([...otherPhones.map(r => r.phone), ...conflicting, ...[...conflicting].filter(p => p!.startsWith("0")).flatMap(p => ["+972" + p!.slice(1), "972" + p!.slice(1)])].filter(Boolean));
  const hashJson = JSON.stringify(hashes), linkIds = JSON.stringify(hashes.map(h => h.slice(0, 24)));
  const orders = JSON.stringify((await rows("SELECT id FROM payment_orders WHERE customer_id=?", id)).map(r => r.id));
  const receipts = JSON.stringify((await rows("SELECT id FROM sales_receipts WHERE customer_id=?", id)).map(r => r.id));
  const voicemails = await rows("SELECT id,audio_ready FROM ivr_voicemails WHERE customer_id=? OR caller_key IN (SELECT value FROM json_each(?))", id, hashJson);
  const removals: Removal[] = [];
  const remove = (table: string, where: string, ...args: unknown[]) => removals.push({ table, where, args });
  for (const table of ["learning_results", "learning_exposures", "learning_batches", "learning_lessons", "learning_targets"]) remove(table, "customer_id=?", id);
  remove("payment_issues", "order_id IN (SELECT value FROM json_each(?))", orders);
  remove("installment_grants", "order_id IN (SELECT value FROM json_each(?)) OR receipt_id IN (SELECT value FROM json_each(?))", orders, receipts);
  for (const table of ["subscription_renewals", "subscription_billing_locks"]) remove(table, `subscription_id ${inSubs}`, subs);
  remove("subscription_members", `customer_id=? OR subscription_id ${inSubs}`, id, subs);
  remove("usage_allocations", "customer_id=? AND NOT EXISTS (SELECT 1 FROM sales_receipts r WHERE r.id=usage_allocations.receipt_id AND r.customer_id<>?)", id, id);
  for (const table of ["invoices", "standing_orders", "payment_orders", "sales_receipts", "portal_tokens", "app_login_codes", "app_sessions", "customer_settings", "navigation_assignments", "navigation_destinations", "navigation_trips"]) remove(table, "customer_id=?", id);
  remove("subscriptions", "customer_id=?", id);
  for (const table of ["active_calls", "conversation_turns", "diagnostic_events", "latency_events", "prompt_snapshots", "navigation_usage_events", "navigation_call_costs"]) remove(table, "call_id IN (SELECT value FROM json_each(?))", calls);
  remove("sessions", "student_id=?", id);
  remove("call_customers", "customer_id=?", id);
  remove("callback_requests", "phone NOT IN (SELECT value FROM json_each(?)) AND (phone IN (SELECT value FROM json_each(?)) OR id IN (SELECT json_extract(body,'$.callback_id') FROM console_records WHERE kind='sales-followups' AND json_extract(body,'$.customer_id')=?))", conflictingJson, phoneJson, id);
  remove("ivr_voicemails", "customer_id=? OR caller_key IN (SELECT value FROM json_each(?))", id, hashJson);
  remove("analytics_attribution", "reference IN (SELECT reference FROM analytics_events WHERE customer_id=? AND reference IS NOT NULL) OR reference=? OR reference IN (SELECT value FROM json_each(?))", id, id, orders);
  remove("analytics_events", "customer_id=?", id);
  remove("console_settings", `id=? OR id IN (SELECT 'ivr:'||value FROM json_each(?)) OR id IN (SELECT 'ivr:payments:'||value FROM json_each(?))
    OR ((id LIKE 'portal-auth:%' OR id LIKE 'portal-email:%' OR id LIKE 'voice-ticket:%') AND
      (json_extract(body,'$.customerId')=? OR json_extract(body,'$.linkCustomer')=? OR json_extract(body,'$.phone') IN (SELECT value FROM json_each(?)) OR (?<>'' AND json_extract(body,'$.email')=?)))`, "ivr:preferences:" + id, calls, calls, id, id, phoneJson, person.email || "", person.email || "");
  remove("console_records", `(kind IN ('customers','learner-phone-links') AND id=?) OR kind IN (?,?)
    OR (kind IN ('enrollments','ivr-events','ad-entries','sales-followups','learner-phone-links') AND json_extract(body,'$.customer_id')=?)
    OR (kind='learner-phone-links' AND (id IN (SELECT value FROM json_each(?)) OR json_extract(body,'$.phone') IN (SELECT value FROM json_each(?))))`, id, "learner-teachers:" + id, "learner-materials:" + id, id, linkIds, phoneJson);
  remove("customer_phones", "customer_id=?", id);
  remove("customers", "id=?", id);

  // Preserve financial records belonging to other customers when removing an owned family plan.
  const detach = [
    ["invoices", "subscription_id"], ["sales_receipts", "subscription_id"], ["standing_orders", "entitlement_id"], ["payment_orders", "entitlement_id"],
  ].map(([table, column]) => env.DB.prepare(`UPDATE ${table} SET ${column}=NULL WHERE customer_id<>? AND ${column} ${inSubs}`).bind(id, subs));
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO console_audit(action,entity_id,created_at) SELECT json_object('action','crm_customer_reset','actor',?,'counts',json_object(${removals.map(r => `'${r.table}',(SELECT COUNT(*) FROM ${r.table} WHERE ${r.where})`).join(",")})),?,?`)
      .bind(actor.username, ...removals.flatMap(r => r.args), id, new Date().toISOString()),
    ...detach,
    ...removals.map(r => env.DB.prepare(`DELETE FROM ${r.table} WHERE ${r.where}`).bind(...r.args)),
  ]);
  let r2Objects = 0;
  if (voicemails.length) {
    try {
      if (!env.VOICEMAIL_AUDIO) throw new Error("R2 unavailable");
      await env.VOICEMAIL_AUDIO.delete(voicemails.map(v => `voicemails/${v.id}.mp3`));
      r2Objects = voicemails.length;
    } catch { console.warn(JSON.stringify({ event: "crm_reset_audio_cleanup_failed", customer_id: id, voicemail_ids: voicemails.map(v => v.id) })); }
  }
  const deleted: Record<string, number> = {};
  removals.forEach((r, i) => { deleted[r.table] = (deleted[r.table] || 0) + Number(result[1 + detach.length + i].meta.changes || 0); });
  return Response.json({ id, deleted, r2_objects: r2Objects }, { headers: { "Cache-Control": "no-store" } });
}
