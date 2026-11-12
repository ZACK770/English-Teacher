import { z } from "zod";
import { bearer, type Env, HttpError, nowIso, randomHex, secureEqual, sha256Hex, tokenUrlsafe } from "./env";
import { BusinessStore, normalizedPhone } from "./business";
import { customerPosition, navigationBody } from "./navigation";
import { PLATFORM_OPENAPI } from "./platform-openapi";

const LOGIN_CODE_TTL_MS = 10 * 60_000;
const LOGIN_CODE_MAX_ATTEMPTS = 5;
const APP_SESSION_TTL_MS = 30 * 86400_000;

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const date = z.string().datetime({ offset: true });
const agorot = z.number().int().min(0).max(100_000_000);
const text = (max: number) => z.string().trim().max(max);

const CustomerCreate = z.object({
  name: text(100).min(1), phone: z.string().min(5).max(40),
  status: z.enum(["lead", "active", "suspended", "closed"]).default("active"),
  city: text(80).default(""), source: text(80).default("platform"), notes: text(2000).default(""),
});
const CustomerPatch = CustomerCreate.partial().refine((v) => Object.keys(v).length > 0, "Empty update");
const PlanCreate = z.object({
  name: text(100).min(1), billing: z.enum(["monthly", "yearly", "one_time", "prepaid"]), price_agorot: agorot,
  included_minutes: z.number().int().min(0).max(1_000_000).nullable().default(null),
  validity_days: z.number().int().min(1).max(3650).nullable().default(null),
  includes_device: z.boolean().default(false), active: z.boolean().default(false), description: text(1000).default(""),
});
const PlanPatch = PlanCreate.partial().refine((v) => Object.keys(v).length > 0, "Empty update");
const SubscriptionStatus = z.enum(["trial", "active", "past_due", "cancelled", "expired"]);
const SubscriptionCreate = z.object({
  customer_id: id, plan_id: id, status: SubscriptionStatus, price_agorot: agorot.optional(),
  started_at: date.optional(), current_period_end: date.nullable().default(null), notes: text(1000).default(""),
});
const SubscriptionPatch = z.object({
  status: SubscriptionStatus, current_period_end: date.nullable(), cancelled_at: date.nullable(), notes: text(1000),
}).partial().refine((v) => Object.keys(v).length > 0, "Empty update");
const SimUpsert = z.object({
  iccid: z.string().regex(/^[0-9]{18,22}F?$/), carrier: text(60).default(""), msisdn: text(20).default(""), plan_name: text(100).default(""),
  data_mb_month: z.number().int().min(0).nullable().default(null), monthly_cost_agorot: agorot.nullable().default(null),
  status: z.enum(["stock", "active", "suspended", "cancelled"]).default("active"), activated_at: date.nullable().default(null), notes: text(1000).default(""),
});
const DevicePatch = z.object({
  model: text(80), imei: z.string().regex(/^([0-9]{15})?$/), sim_iccid: z.string().regex(/^[0-9]{18,22}F?$/).nullable(),
  inventory_status: z.enum(["stock", "in_service", "returned", "faulty", "retired"]), sold_at: date.nullable(), notes: text(1000),
}).partial().refine((v) => Object.keys(v).length > 0, "Empty update");
const InvoiceStatus = z.enum(["open", "paid", "void", "refunded"]);
const InvoiceCreate = z.object({
  customer_id: id, subscription_id: id.nullable().default(null), description: text(300).min(1), amount_agorot: agorot,
  vat_rate: z.number().min(0).max(1).default(0.18), status: InvoiceStatus.default("open"), provider_reference: text(120).nullable().default(null),
  issued_at: date.optional(), paid_at: date.nullable().default(null),
});
const InvoicePatch = z.object({ status: InvoiceStatus, paid_at: date.nullable(), provider_reference: text(120).nullable() })
  .partial().refine((v) => Object.keys(v).length > 0, "Empty update");
const Verify = z.object({ phone: z.string().min(5).max(40), code: z.string().regex(/^[0-9]{6}$/) });
const Destination = z.object({ label: text(80).min(1), address: text(300).min(3) });

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const parseJson = (value: string | null | undefined) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const page = (request: Request, max = 100) => {
  const p = new URL(request.url).searchParams;
  return { limit: Math.max(1, Math.min(Math.floor(Number(p.get("limit")) || 25), max)), offset: Math.max(0, Math.floor(Number(p.get("offset")) || 0)) };
};
const bool = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : v);
const notAllowed = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow } });

async function update(env: Env, table: string, key: string, keyValue: string, patch: Record<string, unknown>, touch = true) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const sets = entries.map(([k]) => k + "=?");
  if (touch) sets.push("updated_at=?");
  const values = [...entries.map(([, v]) => bool(v)), ...(touch ? [nowIso()] : []), keyValue];
  const result = await env.DB.prepare(`UPDATE ${table} SET ${sets.join(",")} WHERE ${key}=?`).bind(...values).run();
  if (!result.meta.changes) throw new HttpError(404, "Not found");
}

const planOut = (p: Record<string, any>) => ({ ...p, includes_device: !!p.includes_device, active: !!p.active });
const costOut = (summary: string | null) => {
  const s = parseJson(summary);
  return s ? { status: s.status, known_subtotal_ils: s.known_subtotal_ils, known_subtotal_usd: s.known_subtotal_usd, basis: s.basis } : null;
};

async function customerRow(env: Env, customerId: string) {
  const c = await env.DB.prepare("SELECT id,name,primary_phone,status,source,city,notes,created_at,updated_at FROM customers WHERE id=?")
    .bind(customerId).first<Record<string, any>>();
  if (!c) throw new HttpError(404, "Customer not found");
  return c;
}

async function deviceSummary(env: Env, customerId: string) {
  const row = await env.DB.prepare(`SELECT d.device_id,d.label,d.model,d.inventory_status,d.sim_iccid,d.last_received_at_ms,
      d.battery_level_pct,d.battery_at_ms,d.charging FROM navigation_assignments a JOIN navigation_devices d ON d.device_id=a.device_id WHERE a.customer_id=?`)
    .bind(customerId).first<Record<string, any>>();
  if (!row) return null;
  return { device_id: row.device_id, label: row.label, model: row.model, inventory_status: row.inventory_status, sim_iccid: row.sim_iccid,
    last_received_at_ms: row.last_received_at_ms,
    battery: { level_percent: row.battery_level_pct, reported_at_ms: row.battery_at_ms, charging: row.charging === null ? null : row.charging === 1, estimate: true } };
}

async function subscriptionsFor(env: Env, customerId: string) {
  const { results } = await env.DB.prepare(`SELECT s.id,s.plan_id,p.name AS plan_name,p.product,p.billing,s.status,s.price_agorot,s.started_at,
      s.current_period_end,s.cancelled_at FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.customer_id=? ORDER BY s.created_at DESC`)
    .bind(customerId).all();
  return results;
}

async function invoicesFor(env: Env, customerId: string) {
  const { results } = await env.DB.prepare(`SELECT id,subscription_id,description,amount_agorot,vat_rate,status,provider,provider_reference,issued_at,paid_at
      FROM invoices WHERE customer_id=? ORDER BY issued_at DESC LIMIT 100`).bind(customerId).all();
  return results;
}

async function tripsFor(env: Env, customerId: string, limit: number, offset: number) {
  const { results } = await env.DB.prepare(`SELECT t.id,t.device_id,t.destination_label,t.destination_address,t.status,t.eta_at_ms,t.created_at_ms,t.ended_at_ms,
      t.last_call_id,k.summary_json FROM navigation_trips t LEFT JOIN navigation_call_costs k ON k.call_id=t.last_call_id
      WHERE t.customer_id=? ORDER BY t.created_at_ms DESC LIMIT ? OFFSET ?`).bind(customerId, limit, offset).all<Record<string, any>>();
  return results.map(({ summary_json, ...t }) => ({ ...t,
    duration_s: t.ended_at_ms ? Math.round((t.ended_at_ms - t.created_at_ms) / 1000) : null, last_call_cost: costOut(summary_json) }));
}

async function callsFor(env: Env, customerId: string, limit: number, offset: number) {
  const { results } = await env.DB.prepare(`SELECT c.call_id,c.bot_id,c.channel,c.created_at,s.duration_seconds,s.summary_he,k.summary_json
      FROM call_customers c LEFT JOIN sessions s ON s.call_id=c.call_id LEFT JOIN navigation_call_costs k ON k.call_id=c.call_id
      WHERE c.customer_id=? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).bind(customerId, limit, offset).all<Record<string, any>>();
  return results.map(({ summary_json, ...c }) => ({ ...c, cost: costOut(summary_json) }));
}

async function customerByPhone(env: Env, rawPhone: string): Promise<string | null> {
  let phone: string;
  try { phone = normalizedPhone(rawPhone); } catch { return null; }
  const row = await env.DB.prepare(`SELECT c.id FROM customers c WHERE c.primary_phone=?
      UNION SELECT p.customer_id FROM customer_phones p JOIN customers c ON c.id=p.customer_id WHERE p.phone=? LIMIT 1`)
    .bind(phone, phone).first<{ id: string }>();
  return row?.id ?? null;
}

export async function issueLoginCode(env: Env, customerId: string) {
  const customer = await customerRow(env, customerId);
  if (customer.status === "closed" || customer.status === "suspended") throw new HttpError(409, "Customer is not active");
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, "0");
  const expires = Date.now() + LOGIN_CODE_TTL_MS;
  await env.DB.prepare(`INSERT INTO app_login_codes(customer_id,code_hash,expires_at_ms,attempts,created_at) VALUES(?,?,?,0,?)
      ON CONFLICT(customer_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at_ms=excluded.expires_at_ms,attempts=0,created_at=excluded.created_at`)
    .bind(customerId, await sha256Hex(customerId + ":" + code), expires, nowIso()).run();
  return { code, expires_at_ms: expires };
}

async function verifyLogin(request: Request, env: Env) {
  const input = await navigationBody(request, Verify);
  const fail = () => new HttpError(401, "הקוד שגוי או שפג תוקפו");
  const customerId = await customerByPhone(env, input.phone);
  if (!customerId) throw fail();
  const row = await env.DB.prepare("SELECT code_hash,expires_at_ms,attempts FROM app_login_codes WHERE customer_id=?")
    .bind(customerId).first<{ code_hash: string; expires_at_ms: number; attempts: number }>();
  if (!row || row.expires_at_ms < Date.now() || row.attempts >= LOGIN_CODE_MAX_ATTEMPTS) throw fail();
  if (!secureEqual(await sha256Hex(customerId + ":" + input.code), row.code_hash)) {
    await env.DB.prepare("UPDATE app_login_codes SET attempts=attempts+1 WHERE customer_id=?").bind(customerId).run();
    throw fail();
  }
  const token = tokenUrlsafe(32);
  const expires = Date.now() + APP_SESSION_TTL_MS;
  await env.DB.prepare("DELETE FROM app_login_codes WHERE customer_id=?").bind(customerId).run();
  await env.DB.prepare("DELETE FROM app_sessions WHERE expires_at_ms<?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO app_sessions(token_hash,customer_id,expires_at_ms,created_at) VALUES(?,?,?,?)")
    .bind(await sha256Hex(token), customerId, expires, nowIso()).run();
  return json({ token, customer_id: customerId, expires_at_ms: expires });
}

async function sessionCustomer(request: Request, env: Env): Promise<string> {
  const token = bearer(request.headers.get("Authorization"));
  if (!token) throw new HttpError(401, "Unauthorized");
  const row = await env.DB.prepare(`SELECT s.customer_id FROM app_sessions s JOIN customers c ON c.id=s.customer_id
      WHERE s.token_hash=? AND s.expires_at_ms>? AND c.status IN ('lead','active')`)
    .bind(await sha256Hex(token), Date.now()).first<{ customer_id: string }>();
  if (!row) throw new HttpError(401, "Unauthorized");
  return row.customer_id;
}

/** Customer-facing API. Every query is scoped to the customer bound to the session token. */
export async function handleApp(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path === "/v1/openapi.json" && request.method === "GET") return json(PLATFORM_OPENAPI);
  if (!path.startsWith("/v1/app/")) return null;
  if (path === "/v1/app/plans" && request.method === "GET") {
    const { results } = await env.DB.prepare(`SELECT id,name,product,billing,price_agorot,included_minutes,validity_days,includes_device,description
        FROM plans WHERE active=1 ORDER BY product,price_agorot`).all<Record<string, any>>();
    return json(results.map((p) => ({ ...p, includes_device: !!p.includes_device })));
  }
  if (path === "/v1/app/auth/verify" && request.method === "POST") return verifyLogin(request, env);
  const customerId = await sessionCustomer(request, env);
  if (path === "/v1/app/auth/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash=?").bind(await sha256Hex(bearer(request.headers.get("Authorization")) ?? "")).run();
    return json({ logged_out: true });
  }
  if (path === "/v1/app/me" && request.method === "GET") {
    const c = await customerRow(env, customerId);
    const { results: phones } = await env.DB.prepare("SELECT phone FROM customer_phones WHERE customer_id=?").bind(customerId).all<{ phone: string }>();
    return json({ customer: { id: c.id, name: c.name, primary_phone: c.primary_phone, status: c.status, city: c.city },
      phones: phones.map((p) => p.phone), subscriptions: await subscriptionsFor(env, customerId), device: await deviceSummary(env, customerId) });
  }
  if (path === "/v1/app/device/live" && request.method === "GET") {
    const live = await customerPosition(env, customerId);
    if (!live) throw new HttpError(404, "No device assigned");
    return json(live);
  }
  if (path === "/v1/app/trips" && request.method === "GET") {
    const { limit, offset } = page(request);
    return json(await tripsFor(env, customerId, limit, offset));
  }
  if (path === "/v1/app/calls" && request.method === "GET") {
    const { limit, offset } = page(request);
    return json(await callsFor(env, customerId, limit, offset));
  }
  const turns = path.match(/^\/v1\/app\/calls\/([^/]{1,120})\/turns$/);
  if (turns && request.method === "GET") {
    const callId = decodeURIComponent(turns[1]);
    const owned = await env.DB.prepare("SELECT 1 FROM call_customers WHERE call_id=? AND customer_id=?").bind(callId, customerId).first();
    if (!owned) throw new HttpError(404, "Call not found");
    const { results } = await env.DB.prepare("SELECT created_at,direction,text FROM conversation_turns WHERE call_id=? ORDER BY id").bind(callId).all();
    return json(results);
  }
  if (path === "/v1/app/invoices" && request.method === "GET") return json(await invoicesFor(env, customerId));
  const dest = path.match(/^\/v1\/app\/destinations(?:\/([a-zA-Z0-9_-]{1,80}))?$/);
  if (dest) {
    const destinationId = dest[1];
    if (!destinationId && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id,label,address,updated_at FROM navigation_destinations WHERE customer_id=? ORDER BY updated_at DESC")
        .bind(customerId).all();
      return json(results);
    }
    if (!destinationId && request.method === "POST") {
      const phone = await env.DB.prepare("SELECT 1 FROM customer_phones WHERE customer_id=?").bind(customerId).first();
      if (!phone) throw new HttpError(409, "Customer has no registered phone");
      const d = await navigationBody(request, Destination);
      const newId = crypto.randomUUID();
      const now = nowIso();
      await env.DB.prepare("INSERT INTO navigation_destinations(id,customer_id,label,address,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .bind(newId, customerId, d.label, d.address, now, now).run();
      return json({ id: newId, ...d }, 201);
    }
    if (destinationId && request.method === "DELETE") {
      const r = await env.DB.prepare("DELETE FROM navigation_destinations WHERE id=? AND customer_id=?").bind(destinationId, customerId).run();
      if (!r.meta.changes) throw new HttpError(404, "Destination not found");
      return json({ deleted: true });
    }
    return notAllowed(destinationId ? "DELETE" : "GET, POST");
  }
  throw new HttpError(404, "App endpoint not found");
}

async function saveCustomer(env: Env, customerId: string | null, input: Partial<z.output<typeof CustomerCreate>>) {
  const store = new BusinessStore(env.DB);
  const existing = customerId ? await store.record("customers", customerId) : null;
  if (customerId && !existing) throw new HttpError(404, "Customer not found");
  const body = { name: "", phone: "", source: "platform", preferred_bot: "", notes: "", ...existing,
    ...Object.fromEntries(Object.entries({ name: input.name, phone: input.phone, source: input.source, notes: input.notes }).filter(([, v]) => v !== undefined)) };
  let saved: { id: string };
  try { saved = await store.save("customers", body, customerId); }
  catch (error) { throw new HttpError(422, error instanceof Error ? error.message : "Invalid customer"); }
  const extra = Object.fromEntries(Object.entries({ status: input.status, city: input.city }).filter(([, v]) => v !== undefined));
  if (Object.keys(extra).length) await update(env, "customers", "id", saved.id, extra);
  return customerRow(env, saved.id);
}

/** Admin API for the platform; mounted behind the admin bearer check. */
export async function platformAdmin(request: Request, env: Env, path: string): Promise<Response> {
  const m = request.method;
  const sub = path.slice("/v1/admin/app".length);
  if (sub === "/summary" && m === "GET") {
    const q = (sql: string) => env.DB.prepare(sql).first<{ n: number }>().then((r) => r?.n ?? 0);
    return json({ customers: await q("SELECT COUNT(*) AS n FROM customers"), active_subscriptions: await q("SELECT COUNT(*) AS n FROM subscriptions WHERE status IN ('trial','active')"),
      devices: await q("SELECT COUNT(*) AS n FROM navigation_devices"), sims: await q("SELECT COUNT(*) AS n FROM sim_cards"),
      trips: await q("SELECT COUNT(*) AS n FROM navigation_trips"), open_invoices: await q("SELECT COUNT(*) AS n FROM invoices WHERE status='open'") });
  }
  if (sub === "/customers") {
    if (m === "GET") {
      const { limit, offset } = page(request, 200);
      const term = "%" + (new URL(request.url).searchParams.get("q") ?? "").trim() + "%";
      const { results } = await env.DB.prepare(`SELECT c.id,c.name,c.primary_phone,c.status,c.city,c.source,c.created_at,c.updated_at,a.device_id
          FROM customers c LEFT JOIN navigation_assignments a ON a.customer_id=c.id
          WHERE c.name LIKE ? OR COALESCE(c.primary_phone,'') LIKE ? ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`).bind(term, term, limit, offset).all();
      return json(results);
    }
    if (m === "POST") return json(await saveCustomer(env, null, await navigationBody(request, CustomerCreate)), 201);
    return notAllowed("GET, POST");
  }
  const loginCode = sub.match(/^\/customers\/([a-zA-Z0-9_-]{1,100})\/login-code$/);
  if (loginCode && m === "POST") return json(await issueLoginCode(env, loginCode[1]), 201);
  const customer = sub.match(/^\/customers\/([a-zA-Z0-9_-]{1,100})$/);
  if (customer) {
    const cid = customer[1];
    if (m === "GET") {
      const { limit } = page(request);
      return json({ customer: await customerRow(env, cid), subscriptions: await subscriptionsFor(env, cid), device: await deviceSummary(env, cid),
        invoices: await invoicesFor(env, cid), trips: await tripsFor(env, cid, limit, 0), calls: await callsFor(env, cid, limit, 0) });
    }
    if (m === "PATCH") return json(await saveCustomer(env, cid, await navigationBody(request, CustomerPatch)));
    return notAllowed("GET, PATCH");
  }
  if (sub === "/plans") {
    if (m === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM plans ORDER BY product,price_agorot").all<Record<string, any>>();
      return json(results.map(planOut));
    }
    if (m === "POST") {
      const p = await navigationBody(request, PlanCreate);
      const planId = "plan-" + randomHex(8);
      const now = nowIso();
      await env.DB.prepare(`INSERT INTO plans(id,name,product,billing,price_agorot,included_minutes,validity_days,includes_device,active,description,created_at,updated_at)
          VALUES(?,?,'navigation',?,?,?,?,?,?,?,?,?)`).bind(planId, p.name, p.billing, p.price_agorot, p.included_minutes, p.validity_days,
        p.includes_device ? 1 : 0, p.active ? 1 : 0, p.description, now, now).run();
      return json(planOut((await env.DB.prepare("SELECT * FROM plans WHERE id=?").bind(planId).first<Record<string, any>>())!), 201);
    }
    return notAllowed("GET, POST");
  }
  const plan = sub.match(/^\/plans\/([a-zA-Z0-9_-]{1,100})$/);
  if (plan && m === "PATCH") {
    const existing = await env.DB.prepare("SELECT product FROM plans WHERE id=?").bind(plan[1]).first<{ product: string }>();
    if (!existing) throw new HttpError(404, "Plan not found");
    if (existing.product !== "navigation") throw new HttpError(409, "School and translator packages are managed in the business console");
    await update(env, "plans", "id", plan[1], await navigationBody(request, PlanPatch));
    return json(planOut((await env.DB.prepare("SELECT * FROM plans WHERE id=?").bind(plan[1]).first<Record<string, any>>())!));
  }
  if (sub === "/subscriptions") {
    if (m === "GET") {
      const cid = new URL(request.url).searchParams.get("customer_id");
      const { results } = await env.DB.prepare(`SELECT s.*,p.name AS plan_name,p.product FROM subscriptions s JOIN plans p ON p.id=s.plan_id
          WHERE (? IS NULL OR s.customer_id=?) ORDER BY s.created_at DESC LIMIT 500`).bind(cid, cid).all();
      return json(results);
    }
    if (m === "POST") {
      const s = await navigationBody(request, SubscriptionCreate);
      await customerRow(env, s.customer_id);
      const p = await env.DB.prepare("SELECT price_agorot FROM plans WHERE id=?").bind(s.plan_id).first<{ price_agorot: number }>();
      if (!p) throw new HttpError(404, "Plan not found");
      const subId = "sub-" + randomHex(8);
      const now = nowIso();
      await env.DB.prepare(`INSERT INTO subscriptions(id,customer_id,plan_id,status,price_agorot,started_at,current_period_end,notes,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(subId, s.customer_id, s.plan_id, s.status, s.price_agorot ?? p.price_agorot, s.started_at ?? now,
        s.current_period_end, s.notes, now, now).run();
      return json(await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(subId).first(), 201);
    }
    return notAllowed("GET, POST");
  }
  const subscription = sub.match(/^\/subscriptions\/([a-zA-Z0-9_-]{1,100})$/);
  if (subscription && m === "PATCH") {
    await update(env, "subscriptions", "id", subscription[1], await navigationBody(request, SubscriptionPatch));
    return json(await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(subscription[1]).first());
  }
  if (sub === "/sims") {
    if (m === "GET") return json((await env.DB.prepare(`SELECT s.*,d.device_id FROM sim_cards s LEFT JOIN navigation_devices d ON d.sim_iccid=s.iccid
        ORDER BY s.created_at DESC`).all()).results);
    if (m === "POST") {
      const s = await navigationBody(request, SimUpsert);
      const now = nowIso();
      await env.DB.prepare(`INSERT INTO sim_cards(iccid,carrier,msisdn,plan_name,data_mb_month,monthly_cost_agorot,status,activated_at,notes,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(iccid) DO UPDATE SET carrier=excluded.carrier,msisdn=excluded.msisdn,plan_name=excluded.plan_name,
          data_mb_month=excluded.data_mb_month,monthly_cost_agorot=excluded.monthly_cost_agorot,status=excluded.status,activated_at=excluded.activated_at,
          notes=excluded.notes,updated_at=excluded.updated_at`).bind(s.iccid, s.carrier, s.msisdn, s.plan_name, s.data_mb_month, s.monthly_cost_agorot,
        s.status, s.activated_at, s.notes, now, now).run();
      return json(await env.DB.prepare("SELECT * FROM sim_cards WHERE iccid=?").bind(s.iccid).first());
    }
    return notAllowed("GET, POST");
  }
  if (sub === "/devices" && m === "GET") {
    const { results } = await env.DB.prepare(`SELECT d.device_id,d.traccar_device_id,d.label,d.enabled,d.model,d.imei,d.sim_iccid,d.inventory_status,d.sold_at,d.notes,
        d.last_received_at_ms,d.last_report_valid,d.battery_level_pct,d.battery_at_ms,d.charging,a.customer_id
        FROM navigation_devices d LEFT JOIN navigation_assignments a ON a.device_id=d.device_id ORDER BY d.device_id`).all();
    return json(results);
  }
  const device = sub.match(/^\/devices\/([a-zA-Z0-9_-]{1,80})$/);
  if (device && m === "PATCH") {
    const d = await navigationBody(request, DevicePatch);
    if (d.sim_iccid && !(await env.DB.prepare("SELECT 1 FROM sim_cards WHERE iccid=?").bind(d.sim_iccid).first())) throw new HttpError(404, "SIM not found");
    await update(env, "navigation_devices", "device_id", device[1], d, false);
    return json(await env.DB.prepare(`SELECT device_id,label,model,imei,sim_iccid,inventory_status,sold_at,notes FROM navigation_devices WHERE device_id=?`)
      .bind(device[1]).first());
  }
  if (sub === "/invoices") {
    if (m === "GET") {
      const cid = new URL(request.url).searchParams.get("customer_id");
      const { results } = await env.DB.prepare("SELECT * FROM invoices WHERE (? IS NULL OR customer_id=?) ORDER BY issued_at DESC LIMIT 500").bind(cid, cid).all();
      return json(results);
    }
    if (m === "POST") {
      const i = await navigationBody(request, InvoiceCreate);
      await customerRow(env, i.customer_id);
      if (i.subscription_id && !(await env.DB.prepare("SELECT 1 FROM subscriptions WHERE id=? AND customer_id=?").bind(i.subscription_id, i.customer_id).first()))
        throw new HttpError(404, "Subscription not found");
      const invId = "inv-" + randomHex(8);
      const now = nowIso();
      await env.DB.prepare(`INSERT INTO invoices(id,customer_id,subscription_id,description,amount_agorot,vat_rate,status,provider,provider_reference,issued_at,paid_at,created_at)
          VALUES(?,?,?,?,?,?,?,'manual',?,?,?,?)`).bind(invId, i.customer_id, i.subscription_id, i.description, i.amount_agorot, i.vat_rate, i.status,
        i.provider_reference, i.issued_at ?? now, i.paid_at, now).run();
      return json(await env.DB.prepare("SELECT * FROM invoices WHERE id=?").bind(invId).first(), 201);
    }
    return notAllowed("GET, POST");
  }
  const invoice = sub.match(/^\/invoices\/([a-zA-Z0-9_-]{1,100})$/);
  if (invoice && m === "PATCH") {
    const row = await env.DB.prepare("SELECT provider FROM invoices WHERE id=?").bind(invoice[1]).first<{ provider: string }>();
    if (!row) throw new HttpError(404, "Invoice not found");
    if (row.provider !== "manual") throw new HttpError(409, "Provider invoices are read-only");
    await update(env, "invoices", "id", invoice[1], await navigationBody(request, InvoicePatch), false);
    return json(await env.DB.prepare("SELECT * FROM invoices WHERE id=?").bind(invoice[1]).first());
  }
  throw new HttpError(404, "Platform endpoint not found");
}
