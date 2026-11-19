import { z } from "zod";
import { nowIso, randomHex, sha256Hex, tokenUrlsafe } from "./env";
import { SCHOOL_CALL_FILTER, SCHOOL_SESSION_FILTER } from "./school-history";
import { canPurchaseAutomatically, SCHOOL_FREE_POLICY } from "../../src/pricing";
import { visiblePhone } from "./phone";

export const CustomerSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(5).max(40),
  source: z.string().max(80).default("organic"),
  preferred_bot: z.string().max(63).default(""),
  notes: z.string().max(2000).default(""),
});
export const PackageSchema = z.object({
  name: z.string().min(1).max(100),
  product: z.enum(["school", "translator"]),
  minutes: z.number().int().min(1).max(100000),
  price_ils: z.number().min(0).max(100000),
  validity_days: z.number().int().min(1).max(3650).default(30),
  max_call_minutes: z.number().int().min(1).max(60).default(5),
  tagline: z.string().max(120).default(""),
  billing: z.enum(["prepaid", "monthly", "yearly", "one_time"]).default("prepaid"),
  automated_purchase: z.boolean().default(true),
  duration_months: z.number().int().min(1).max(12).optional(),
  annual_price_ils: z.number().min(0).optional(),
  first_month_price_ils: z.number().min(0).optional(),
  anchor_price_ils: z.number().min(0).optional(),
  recommended: z.boolean().default(false),
  active: z.boolean().default(false),
  phone_enabled: z.boolean().default(true),
});
export type Package = z.output<typeof PackageSchema>;
export const ReceiptSchema = z.object({
  customer_id: z.string(),
  package_id: z.string(),
  reference: z.string().min(3).max(150),
  amount_ils: z.number().min(0).max(100000),
});
const LessonSchema = z.object({
  title: z.string().min(1).max(160),
  goal: z.string().max(1000).default(""),
  instructions: z.string().max(6000).default(""),
  passing_score: z.number().int().min(1).max(5).default(3),
});
export const CourseSchema = z.object({
  name: z.string().min(1).max(120),
  level: z.string().max(60).default("basic"),
  bot_id: z.string().max(63).default(""),
  lessons: z.array(LessonSchema).max(100).default([]),
  active: z.boolean().default(false),
});
export const EnrollmentSchema = z.object({
  customer_id: z.string(),
  course_id: z.string(),
  lesson_index: z.number().int().min(0).max(99).default(0),
  status: z.enum(["active", "completed", "paused"]).default("active"),
});
export const NarrationSchema = z.object({
  name: z.string().min(1).max(120),
  placement: z.enum(["welcome", "language_menu", "quota", "upsell", "service", "other"]),
  text: z.string().min(1).max(6000),
  language: z.string().max(20).default("he-IL"),
  bot_id: z.string().max(63).default(""),
  technoline_extension: z.string().max(150).default(""),
  status: z.enum(["draft", "approved"]).default("draft"),
});
export const AccessPolicySchema = z.object({
  enabled: z.boolean().default(false),
  product: z.enum(["school", "translator"]).default("school"),
  free_calls_month: z.number().int().min(0).max(100).default(0),
  free_call_seconds: z.number().int().min(10).max(600).default(60),
  opening_seconds: z.number().int().min(0).max(600).default(0),
  blocked_extension: z.string().max(150).refine((v) => v.startsWith("/"), "שלוחה צריכה להתחיל בלוכסן").default("/"),
  basic_enabled: z.boolean().default(false),
  basic_calls_day: z.number().int().min(0).max(50).default(3),
  basic_call_seconds: z.number().int().min(30).max(900).default(120),
  basic_month_seconds: z.number().int().min(0).max(500000).default(3000),
  basic_intro_text: z.string().max(400).default(""),
});
export type AccessPolicy = z.output<typeof AccessPolicySchema>;
export const EconomicsSchema = z.object({
  vat_rate: z.number().min(0).max(0.5).default(0.18),
  usd_ils: z.number().gt(0).max(20).default(3.7),
  fixed_monthly_ils: z.number().min(0).default(0),
  paid_marketing_ils: z.number().min(0).default(0),
  owner_hours_month: z.number().min(0).max(744).default(30),
  owner_hour_value: z.number().min(0).default(0),
  development_cash: z.number().min(0).default(500),
  development_self_work: z.number().min(0).default(1500),
  forecast_price_ils: z.number().min(0).default(0),
  forecast_minutes: z.number().min(0).default(0),
  forecast_cost_per_minute: z.number().min(0).default(0),
  forecast_payment_fee: z.number().min(0).default(0),
  forecast_lifetime_months: z.number().min(0).default(0),
  free_budget_ils: z.number().min(0).default(0),
  school_price_ils: z.number().min(0).default(0),
  school_minutes: z.number().min(0).default(0),
  school_minute_cost: z.number().min(0).default(0),
  translator_price_ils: z.number().min(0).default(0),
  translator_minutes: z.number().min(0).default(0),
  translator_minute_cost: z.number().min(0).default(0),
});
export type Economics = z.output<typeof EconomicsSchema>;

export const MODELS: Record<string, z.ZodTypeAny> = {
  customers: CustomerSchema,
  packages: PackageSchema,
  courses: CourseSchema,
  enrollments: EnrollmentSchema,
  narrations: NarrationSchema,
  policies: AccessPolicySchema,
};

export function normalizedPhone(value: string): string {
  const digits = visiblePhone(String(value));
  if (!digits) throw new Error("נדרש מספר טלפון תקין");
  return digits;
}

const month = () => new Date().toISOString().slice(0, 7);
const RESERVATION_TTL_MS = 3 * 60 * 60 * 1000;
const reservationCutoff = () => new Date(Date.now() - RESERVATION_TTL_MS).toISOString().replace("Z", "+00:00");
export const UNMETERED_SESSION_PRODUCT = "unrestricted";

export interface Allowance { seconds: number; mode: string; extension?: string; intro?: string }

export class BusinessStore {
  constructor(public db: D1Database) {}

  async list(kind: string): Promise<Record<string, any>[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM console_records WHERE kind=? ORDER BY updated_at DESC")
      .bind(kind)
      .all<{ id: string; body: string; updated_at: string }>();
    return results.map((r) => ({ ...JSON.parse(r.body), id: r.id, updated_at: r.updated_at })).filter((r) => kind !== "packages" || !r.retired);
  }

  async record(kind: string, id: string): Promise<Record<string, any> | null> {
    const row = await this.db.prepare("SELECT body FROM console_records WHERE kind=? AND id=?").bind(kind, id).first<{ body: string }>();
    return row ? JSON.parse(row.body) : null;
  }

  async save(kind: string, body: Record<string, any>, entityId?: string | null) {
    const id = entityId || randomHex(10);
    const stmts: D1PreparedStatement[] = [];
    if (kind === "customers") {
      body.phone = normalizedPhone(body.phone);
      const other = await this.db.prepare("SELECT customer_id FROM customer_phones WHERE phone=?").bind(body.phone).first<{ customer_id: string }>();
      if (other && other.customer_id !== id) throw new Error("מספר טלפון שכבר רשום");
      stmts.push(this.db.prepare("INSERT INTO customer_phones(phone,customer_id) VALUES (?,?) ON CONFLICT(customer_id) DO UPDATE SET phone=excluded.phone").bind(body.phone, id));
    }
    if (kind === "courses" && body.active) {
      const teacher = await this.db.prepare("SELECT 1 FROM bots WHERE id=? AND role='teacher'").bind(body.bot_id).first();
      if (!body.lessons?.length || !teacher) throw new Error("למסלול פעיל נדרשים מורה ולפחות שיעור אחד");
    }
    if (kind === "enrollments") {
      const customer = await this.record("customers", body.customer_id);
      const course = await this.record("courses", body.course_id);
      if (!customer || !course) throw new Error("הלקוח או המסלול לא נמצאו");
      if (body.lesson_index >= course.lessons.length) throw new Error("השיעור שנבחר אינו קיים במסלול");
    }
    const now = nowIso();
    stmts.push(
      this.db
        .prepare("INSERT INTO console_records VALUES (?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at")
        .bind(kind, id, JSON.stringify(body), now, now),
      this.db.prepare("INSERT INTO console_audit(action,entity_id,created_at) VALUES (?,?,?)").bind("save:" + kind, id, now),
    );
    if (kind === "customers") {
      stmts.push(this.db.prepare(`INSERT INTO customers(id,name,primary_phone,source,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,primary_phone=excluded.primary_phone,source=excluded.source,notes=excluded.notes,updated_at=excluded.updated_at`)
        .bind(id, body.name ?? "", body.phone, body.source ?? "", body.notes ?? "", now, now));
    }
    if (kind === "packages") {
      stmts.push(this.db.prepare(`INSERT INTO plans(id,name,product,billing,price_agorot,included_minutes,validity_days,active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,product=excluded.product,billing=excluded.billing,price_agorot=excluded.price_agorot,
        included_minutes=excluded.included_minutes,validity_days=excluded.validity_days,active=excluded.active,updated_at=excluded.updated_at`)
        .bind(id, body.name, body.product, body.billing ?? "prepaid", Math.round(Number(body.price_ils) * 100), body.minutes, body.validity_days, body.active ? 1 : 0, now, now));
    }
    await this.db.batch(stmts);
    return { id, ...body };
  }

  async saveAudio(narrationId: string, textHash: string, wav: Uint8Array) {
    await this.db.prepare("INSERT OR REPLACE INTO narration_audio VALUES (?,?,?,?)").bind(narrationId, textHash, wav, nowIso()).run();
  }

  async getAudio(narrationId: string): Promise<{ narration_id: string; text_hash: string; wav: Uint8Array } | null> {
    const row = await this.db.prepare("SELECT * FROM narration_audio WHERE narration_id=?").bind(narrationId).first<Record<string, any>>();
    if (!row) return null;
    return { narration_id: row.narration_id, text_hash: row.text_hash, wav: new Uint8Array(row.wav as ArrayBuffer | number[]) };
  }

  async identifyCall(caller: string, callId: string, botId: string): Promise<string> {
    let phone: string | null = null;
    try {
      phone = normalizedPhone(caller);
    } catch {
      phone = null;
    }
    const existing = await this.db.prepare("SELECT customer_id FROM call_customers WHERE call_id=?").bind(callId).first<{ customer_id: string }>();
    if (existing) {
      if (botId !== "ivr") await this.db.prepare("UPDATE call_customers SET bot_id=? WHERE call_id=?").bind(botId, callId).run();
      return existing.customer_id;
    }
    const linked = phone ? await this.customerForPhone(phone) : null;
    const row = linked ? { customer_id: linked } : null;
    const customerId = row ? row.customer_id : phone ? "tel-" + (await sha256Hex(phone)).slice(0, 24) : "anonymous-" + randomHex(12);
    const now = nowIso();
    const stmts: D1PreparedStatement[] = [];
    if (phone && !row) {
      const body = { name: "לקוח מהטלפון", phone, source: "organic", preferred_bot: "", notes: "" };
      stmts.push(
        this.db.prepare("INSERT OR IGNORE INTO customer_phones VALUES (?,?)").bind(phone, customerId),
        this.db.prepare("INSERT OR IGNORE INTO console_records VALUES ('customers',?,?,?,?)").bind(customerId, JSON.stringify(body), now, now),
        this.db.prepare("INSERT OR IGNORE INTO customers(id,name,primary_phone,source,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(customerId, body.name, phone, body.source, now, now),
      );
    }
    stmts.push(this.db.prepare("INSERT OR IGNORE INTO call_customers VALUES (?,?,?,?,?)").bind(callId, customerId, botId, "phone", now));
    await this.db.batch(stmts);
    return customerId;
  }

  async customerForPhone(phone: string): Promise<string | null> {
    const primary = await this.db.prepare("SELECT customer_id FROM customer_phones WHERE phone=?").bind(phone).first<{ customer_id: string }>();
    if (primary) return primary.customer_id;
    const linked = await this.record("learner-phone-links", (await sha256Hex(phone)).slice(0, 24));
    return linked?.customer_id ?? null;
  }

  async consumeMonthlyQuota(api: string, limit: number): Promise<boolean> {
    const result = await this.db
      .prepare(`INSERT INTO api_quota (month, api, used) SELECT ?, ?, 1 WHERE ? > 0
        ON CONFLICT(month, api) DO UPDATE SET used = used + 1 WHERE used < ?`)
      .bind(month(), api, limit, limit)
      .run();
    return result.meta.changes === 1;
  }

  async refundMonthlyQuota(api: string, quotaMonth = month()): Promise<void> {
    await this.db.prepare("UPDATE api_quota SET used=MAX(0,used-1) WHERE month=? AND api=?")
      .bind(quotaMonth, api).run();
  }

  async reserveCall(customerId: string, botId: string, callId: string, maxSeconds: number, channel: "voice" | "text" = "voice"): Promise<Allowance> {
    const policyRow = await this.record("policies", botId);
    const teacher = !policyRow && await this.db.prepare("SELECT 1 FROM bots WHERE id=? AND role='teacher'").bind(botId).first();
    const policy = AccessPolicySchema.parse(policyRow ?? (teacher ? SCHOOL_FREE_POLICY : {}));
    const now = nowIso();
    const cutoff = reservationCutoff();
    const activeSession = "SELECT 1 FROM usage_allocations WHERE customer_id=? AND billed_seconds IS NULL AND created_at>?";
    const busy = { seconds: 0, mode: "busy" };
    if (!policy.enabled) {
      const allocation = await this.db.prepare(`
        INSERT OR IGNORE INTO usage_allocations
          (call_id,customer_id,product,receipt_id,reserved_seconds,billed_seconds,created_at)
        SELECT ?,?,?,NULL,0,NULL,? WHERE NOT EXISTS (${activeSession})
        RETURNING call_id
      `).bind(callId, customerId, UNMETERED_SESSION_PRODUCT, now, customerId, cutoff).first();
      return allocation ? { seconds: maxSeconds, mode: "unrestricted" } : busy;
    }
    const { results: receipts } = await this.db
      .prepare(`SELECT r.*, COALESCE(SUM(COALESCE(u.billed_seconds, u.reserved_seconds)),0) AS spent
        FROM sales_receipts r LEFT JOIN usage_allocations u ON u.receipt_id=r.id
        WHERE (r.customer_id=? OR r.subscription_id IN
          (SELECT m.subscription_id FROM subscription_members m JOIN subscriptions s ON s.id=m.subscription_id
           WHERE m.customer_id=? AND m.removed_at IS NULL AND s.status IN ('active','cancelled','past_due')))
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.id=r.subscription_id AND s.status='paused')
        AND r.product=? AND r.expires_at>? AND (r.valid_from IS NULL OR r.valid_from<=?) GROUP BY r.id ORDER BY r.expires_at`)
      .bind(customerId, customerId, policy.product, now, now)
      .all<Record<string, any>>();
    for (const receipt of receipts) {
      const pkg = PackageSchema.safeParse(await this.record("packages", receipt.package_id));
      const cap = pkg.success ? Math.min(maxSeconds, pkg.data.max_call_minutes * 60) : maxSeconds;
      const allocation = await this.db.prepare(`
        INSERT OR IGNORE INTO usage_allocations
          (call_id,customer_id,product,receipt_id,reserved_seconds,billed_seconds,created_at)
        SELECT ?,customer_id,product,id,MIN(?,remaining),NULL,?
        FROM (
          SELECT r.id,r.customer_id,r.product,r.minutes * 60 - COALESCE(SUM(COALESCE(u.billed_seconds,u.reserved_seconds)),0) AS remaining
          FROM sales_receipts r LEFT JOIN usage_allocations u ON u.receipt_id=r.id
          WHERE r.id=? AND r.expires_at>? GROUP BY r.id
        )
        WHERE remaining>=1 AND NOT EXISTS (${activeSession}) RETURNING reserved_seconds
      `).bind(callId, cap, now, receipt.id, now, customerId, cutoff).first<{ reserved_seconds: number }>();
      if (allocation) return { seconds: allocation.reserved_seconds, mode: "paid" };
    }
    const anonymous = customerId.startsWith("anonymous-");
    if (!anonymous && channel === "voice" && policy.opening_seconds) {
      const openingProduct = policy.product + "-opening";
      const seconds = Math.min(maxSeconds, policy.opening_seconds);
      const opening = await this.db.prepare(`INSERT OR IGNORE INTO usage_allocations
        SELECT ?,?,?,NULL,?,NULL,? WHERE NOT EXISTS (${activeSession}) AND NOT EXISTS
        (SELECT 1 FROM usage_allocations WHERE customer_id=? AND product=? AND billed_seconds>=60)`)
        .bind(callId, customerId, openingProduct, seconds, now, customerId, cutoff, customerId, openingProduct).run();
      if (opening.meta.changes) {
        return { seconds, mode: "free" };
      }
    }
    const monthPrefix = now.slice(0, 7) + "%";
    if (!anonymous && policy.free_calls_month > 0) {
      const seconds = Math.min(maxSeconds, policy.free_call_seconds);
      const allocation = await this.db.prepare(`
        INSERT OR IGNORE INTO usage_allocations
          (call_id,customer_id,product,receipt_id,reserved_seconds,billed_seconds,created_at)
        SELECT ?,?,?,NULL,?,NULL,?
        WHERE (
          SELECT COUNT(*) FROM usage_allocations WHERE customer_id=? AND product=? AND receipt_id IS NULL
            AND created_at LIKE ? AND (billed_seconds IS NULL OR billed_seconds>0)
        ) < ? AND NOT EXISTS (${activeSession})
        RETURNING reserved_seconds
      `).bind(callId, customerId, policy.product, seconds, now, customerId, policy.product, monthPrefix, policy.free_calls_month, customerId, cutoff).first();
      if (allocation) return { seconds, mode: "free" };
    }
    if (policy.basic_enabled && !anonymous) {
      const product = policy.product + "-basic";
      const allocation = await this.db.prepare(`
        INSERT OR IGNORE INTO usage_allocations
          (call_id,customer_id,product,receipt_id,reserved_seconds,billed_seconds,created_at)
        SELECT ?,?,?,NULL,MIN(?,remaining),NULL,?
        FROM (
          SELECT ? - COALESCE(SUM(COALESCE(billed_seconds,reserved_seconds)),0) AS remaining
          FROM usage_allocations WHERE product=? AND created_at LIKE ?
        )
        WHERE remaining>=10 AND (
          SELECT COUNT(*) FROM usage_allocations WHERE customer_id=? AND product=? AND created_at LIKE ?
            AND (billed_seconds IS NULL OR billed_seconds>0)
        ) < ? AND NOT EXISTS (${activeSession})
        RETURNING reserved_seconds
      `).bind(callId, customerId, product, Math.min(maxSeconds, policy.basic_call_seconds), now,
        policy.basic_month_seconds, product, monthPrefix, customerId, product, now.slice(0, 10) + "%", policy.basic_calls_day, customerId, cutoff)
        .first<{ reserved_seconds: number }>();
      if (allocation) return { seconds: allocation.reserved_seconds, mode: "basic", intro: policy.basic_intro_text };
    }
    if (await this.db.prepare(activeSession).bind(customerId, cutoff).first()) return busy;
    return { seconds: 0, mode: "blocked", extension: policy.blocked_extension };
  }

  async cancelCallReservation(callId: string) {
    await this.db.prepare("DELETE FROM usage_allocations WHERE call_id=? AND billed_seconds IS NULL").bind(callId).run();
  }

  async settleCall(callId: string, seconds: number) {
    await this.db
      .prepare("UPDATE usage_allocations SET billed_seconds=MIN(reserved_seconds,?) WHERE call_id=? AND billed_seconds IS NULL")
      .bind(Math.max(0, seconds), callId)
      .run();
  }

  async releaseStaleReservations() {
    await this.db.prepare("UPDATE usage_allocations SET billed_seconds=0 WHERE billed_seconds IS NULL AND created_at<=?")
      .bind(reservationCutoff())
      .run();
  }

  async linkCallSegment(parentCallId: string, segmentId: string, botId: string) {
    const parent = await this.db.prepare("SELECT customer_id FROM call_customers WHERE call_id=?").bind(parentCallId).first<{ customer_id: string }>();
    if (!parent) throw new Error("Call must enter authenticated IVR before streaming");
    await this.db.prepare("INSERT INTO call_customers VALUES (?,?,?,?,?)").bind(segmentId, parent.customer_id, botId, "phone", nowIso()).run();
  }

  async customerForCall(callId: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT customer_id FROM call_customers WHERE call_id=?").bind(callId).first<{ customer_id: string }>();
    return row?.customer_id ?? null;
  }

  async customerDetail(customerId: string) {
    const body = await this.record("customers", customerId);
    if (!body) throw new Error("Customer not found");
    const [receipts, calls] = await this.db.batch<Record<string, any>>([
      this.db.prepare(`SELECT r.*, COALESCE(SUM(COALESCE(u.billed_seconds,u.reserved_seconds)),0) AS spent_seconds FROM sales_receipts r
        LEFT JOIN usage_allocations u ON u.receipt_id=r.id WHERE r.customer_id=? GROUP BY r.id ORDER BY r.created_at DESC`).bind(customerId),
      this.db.prepare(`SELECT c.call_id,c.bot_id,c.channel,c.created_at,sessions.duration_seconds,sessions.summary_he,sessions.points FROM call_customers c
        LEFT JOIN sessions ON c.call_id=sessions.call_id WHERE c.customer_id=? AND ${SCHOOL_CALL_FILTER} AND ${SCHOOL_SESSION_FILTER} ORDER BY c.created_at DESC LIMIT 50`).bind(customerId),
    ]);
    const customer = (await this.list("customers")).find((c) => c.id === customerId) ?? { ...body, id: customerId };
    return { customer, receipts: receipts.results, calls: calls.results, access: await this.accessSummary(customerId, receipts.results) };
  }

  async accessSummary(customerId: string, receipts: Record<string, any>[]) {
    const policies = (await this.list("policies")).map((p) => AccessPolicySchema.parse(p)).filter((p) => p.product === "school");
    const policy = policies.find((p) => p.enabled) ?? (policies.length ? undefined : AccessPolicySchema.parse(SCHOOL_FREE_POLICY));
    if (!policy) return { limited: false, opening_minutes: 0, free_calls_left: 0, free_call_minutes: 0, plan_name: "", max_call_minutes: 0 };
    const used = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM usage_allocations WHERE customer_id=? AND product=? AND receipt_id IS NULL AND created_at LIKE ? AND (billed_seconds IS NULL OR billed_seconds>0)`)
      .bind(customerId, "school", month() + "%")
      .first<{ n: number }>();
    const now = nowIso();
    const live = receipts.find((r) => r.product === "school" && r.expires_at > now && r.minutes * 60 - r.spent_seconds >= 1);
    const pkg = live ? PackageSchema.safeParse(await this.record("packages", live.package_id)) : null;
    const opening = await this.db.prepare("SELECT 1 FROM usage_allocations WHERE customer_id=? AND product='school-opening' AND (billed_seconds IS NULL OR billed_seconds>=60)").bind(customerId).first();
    return {
      limited: true,
      opening_minutes: !customerId.startsWith("anonymous-") && !opening ? policy.opening_seconds / 60 : 0,
      free_calls_left: customerId.startsWith("anonymous-") ? 0 : Math.max(0, policy.free_calls_month - (used?.n ?? 0)),
      free_call_minutes: Math.round(policy.free_call_seconds / 60),
      plan_name: pkg?.success ? pkg.data.name.split(" · ")[0] : "",
      max_call_minutes: pkg?.success ? pkg.data.max_call_minutes : 0,
    };
  }

  async portalInvite(customerId: string) {
    await this.customerDetail(customerId);
    const token = tokenUrlsafe(32);
    const expires = new Date(Date.now() + 7 * 86400_000).toISOString().replace("Z", "+00:00");
    await this.db.batch([
      this.db.prepare("DELETE FROM portal_tokens WHERE customer_id=?").bind(customerId),
      this.db.prepare("INSERT INTO portal_tokens VALUES (?,?,?)").bind(await sha256Hex(token), customerId, expires),
    ]);
    return { token, expires_at: expires };
  }

  async portalCustomer(token: string): Promise<string | null> {
    if (!token) return null;
    const row = await this.db
      .prepare("SELECT customer_id FROM portal_tokens WHERE token_hash=? AND expires_at>?")
      .bind(await sha256Hex(token), nowIso())
      .first<{ customer_id: string }>();
    return row?.customer_id ?? null;
  }

  async registerWebCall(callId: string, customerId: string, botId: string) {
    await this.db.prepare("INSERT INTO call_customers VALUES (?,?,?,?,?)").bind(callId, customerId, botId, "web", nowIso()).run();
  }

  async lessonContext(customerId: string, botId: string): Promise<string> {
    const courses = Object.fromEntries((await this.list("courses")).map((c) => [c.id, c]));
    for (const item of await this.list("enrollments")) {
      const course = courses[item.course_id];
      if (item.customer_id !== customerId || item.status !== "active" || !course || !course.active || course.bot_id !== botId) continue;
      if (item.lesson_index < course.lessons.length) {
        return (
          "\nCurrent enrolled lesson (administrator instructions):\n" +
          JSON.stringify(course.lessons[item.lesson_index]) +
          "\nUse demonstration, guided practice, free conversation and a summary."
        );
      }
    }
    return "";
  }

  async setting<T = any>(id: string): Promise<T | null> {
    const row = await this.db.prepare("SELECT body FROM console_settings WHERE id=?").bind(id).first<{ body: string }>();
    return row ? (JSON.parse(row.body) as T) : null;
  }

  async putSetting(id: string, value: unknown) {
    await this.db.prepare("INSERT OR REPLACE INTO console_settings VALUES (?,?)").bind(id, JSON.stringify(value)).run();
  }

  async audit(action: string, entityId: string) {
    await this.db.prepare("INSERT INTO console_audit(action,entity_id,created_at) VALUES (?,?,?)").bind(action, entityId, nowIso()).run();
  }

  async economics(): Promise<Economics> {
    return EconomicsSchema.parse((await this.setting("economics")) ?? {});
  }

  async saveEconomics(value: Economics) {
    await this.putSetting("economics", value);
    return value;
  }

  async loadContext(callId: string): Promise<Record<string, any>> {
    return (await this.setting("ivr:" + callId)) ?? {};
  }

  async saveContext(callId: string, values: Record<string, any>) {
    const context = await this.loadContext(callId);
    await this.putSetting("ivr:" + callId, { ...context, ...values });
  }

  async savePreference(customerId: string, input: Record<string, any>) {
    const values = { ...input };
    if (values.mode === "course" || values.mode === "free") values.school_mode = values.mode;
    const bot = values.selected_bot
      ? await this.db.prepare("SELECT role FROM bots WHERE id=?").bind(values.selected_bot).first<{ role: string }>()
      : null;
    const isTeacher = bot?.role === "teacher";
    if (isTeacher) values.teacher_bot = values.selected_bot;
    await this.saveContext("preferences:" + customerId, values);
    if (isTeacher) {
      const body = await this.record("customers", customerId);
      if (body) {
        body.preferred_bot = values.selected_bot;
        await this.db.prepare("UPDATE console_records SET body=?,updated_at=? WHERE kind='customers' AND id=?").bind(JSON.stringify(body), nowIso(), customerId).run();
      }
    }
  }

  async receipt(value: z.output<typeof ReceiptSchema>) {
    const economics = await this.economics();
    const packageBody = await this.record("packages", value.package_id);
    const customer = await this.record("customers", value.customer_id);
    if (!packageBody || !customer) throw new Error("לקוח או חבילה לא נמצאו");
    const pkg = PackageSchema.parse(packageBody);
    if (!canPurchaseAutomatically(pkg)) throw new Error("ההצטרפות למסלול זה דרך נציג; אין להטעין זכאות חודשית כקבלה חד־פעמית");
    if (!pkg.active) throw new Error("החבילה אינה פעילה");
    const id = randomHex(10);
    const expires = new Date(Date.now() + pkg.validity_days * 86400_000).toISOString().replace("Z", "+00:00");
    await this.db
      .prepare("INSERT INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, value.customer_id, value.package_id, pkg.product, value.reference, value.amount_ils, economics.vat_rate, pkg.minutes, expires, nowIso())
      .run();
    return { id, expires_at: expires };
  }

  async performance(botId: string) {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { results } = await this.db
      .prepare("SELECT call_id,event_name,since_call_start_ms,details_json FROM latency_events WHERE profile_id=? AND created_at>? ORDER BY call_id,since_call_start_ms")
      .bind(botId, since)
      .all<Record<string, any>>();
    const calls: Record<string, Record<string, any>[]> = {};
    for (const r of results) (calls[r.call_id] ??= []).push(r);
    const connection: number[] = [], greeting: number[] = [], delivery: number[] = [];
    for (const events of Object.values(calls)) {
      const markers: Record<string, number> = {};
      for (const r of events) markers[r.event_name] = r.since_call_start_ms;
      if ("gemini_connected" in markers && "gemini_connect_started" in markers) connection.push(markers.gemini_connected - markers.gemini_connect_started);
      const first = events.find((r) => r.event_name === "first_gemini_audio");
      if (first && "greeting_sent" in markers) greeting.push(first.since_call_start_ms - markers.greeting_sent);
      const ready: Record<string, number> = {};
      for (const r of events) {
        const turn = JSON.parse(r.details_json).tutor_turn;
        if (r.event_name === "first_gemini_audio") ready[turn] = r.since_call_start_ms;
        if (r.event_name === "first_audio_sent_to_phone" && turn in ready) delivery.push(r.since_call_start_ms - ready[turn]);
      }
    }
    const stats = (input: number[]) => {
      const v = input.filter((x) => x >= 0).sort((a, b) => a - b);
      if (!v.length) return { samples: 0, p50: null, p95: null };
      return { samples: v.length, p50: Math.round(v[Math.floor((v.length - 1) / 2)]), p95: Math.round(v[Math.ceil(v.length * 0.95) - 1]) };
    };
    return { days: 30, connection: stats(connection), first_greeting: stats(greeting), server_delivery: stats(delivery) };
  }

  async summary() {
    const s = await this.economics();
    const m = month();
    const [salesResult, usageResult] = await this.db.batch<Record<string, any>>([
      this.db.prepare("SELECT * FROM sales_receipts ORDER BY created_at DESC"),
      this.db.prepare(`SELECT s.call_id,s.duration_seconds,s.estimated_cost_usd,s.started_at,c.customer_id,c.bot_id,b.role,u.receipt_id,u.call_id AS metered_call
        FROM sessions s LEFT JOIN call_customers c ON c.call_id=s.call_id LEFT JOIN bots b ON b.id=c.bot_id
        LEFT JOIN usage_allocations u ON u.call_id=s.call_id AND u.product<>?`).bind(UNMETERED_SESSION_PRODUCT),
    ]);
    const sales = salesResult.results;
    const usage = usageResult.results;
    const round = (v: number) => Math.round(v * 100) / 100;
    const monthlySales = sales.filter((r) => String(r.created_at).startsWith(m));
    const net = monthlySales.reduce((a, r) => a + r.amount_ils / (1 + r.vat_rate), 0);
    const monthlyUsage = usage.filter((r) => String(r.started_at).startsWith(m));
    const aiCost = monthlyUsage.reduce((a, r) => a + r.estimated_cost_usd, 0) * s.usd_ils;
    let freeCost = 0;
    for (const row of monthlyUsage) {
      if (
        row.role === "translator" &&
        ((row.metered_call && row.receipt_id === null) ||
          !sales.some((r) => r.customer_id === row.customer_id && r.product === "translator" && r.created_at <= row.started_at && row.started_at < r.expires_at))
      ) freeCost += row.estimated_cost_usd * s.usd_ils;
    }
    const newPayers = new Set(
      monthlySales.filter((r) => !sales.some((old) => old.customer_id === r.customer_id && old.created_at < m)).map((r) => r.customer_id),
    );
    const contribution = s.forecast_price_ils / (1 + s.vat_rate) - s.forecast_minutes * s.forecast_cost_per_minute - s.forecast_payment_fee;
    const knownProfit = net - aiCost - s.fixed_monthly_ils - s.paid_marketing_ils;
    const products: Record<string, unknown> = {};
    for (const product of ["school", "translator"] as const) {
      const productSales = monthlySales.filter((r) => r.product === product);
      const productUsage = monthlyUsage.filter((r) => r.customer_id && (r.role === "translator") === (product === "translator"));
      const price = s[`${product}_price_ils`], minutes = s[`${product}_minutes`], minuteCost = s[`${product}_minute_cost`];
      const forecast = price / (1 + s.vat_rate) - minutes * minuteCost;
      products[product] = {
        paying_customers: new Set(productSales.map((r) => r.customer_id)).size,
        net_receipts: round(productSales.reduce((a, r) => a + r.amount_ils / (1 + r.vat_rate), 0)),
        minutes: Math.round((productUsage.reduce((a, r) => a + r.duration_seconds, 0) / 60) * 10) / 10,
        ai_cost: round(productUsage.reduce((a, r) => a + r.estimated_cost_usd, 0) * s.usd_ils),
        forecast_contribution: round(forecast),
        scenarios: [100, 500, 1000].map((n) => ({ customers: n, contribution: round(n * forecast) })),
      };
    }
    return {
      period: m,
      customers: (await this.list("customers")).length,
      paying_customers_month: new Set(monthlySales.map((r) => r.customer_id)).size,
      gross_receipts_ils: round(monthlySales.reduce((a, r) => a + r.amount_ils, 0)),
      net_receipts_ils: round(net),
      ai_cost_ils: round(aiCost),
      free_translator_ad_cost_ils: round(freeCost),
      known_cash_surplus_ils: round(knownProfit),
      cac_ils: newPayers.size ? round((s.paid_marketing_ils + freeCost) / newPayers.size) : null,
      ltv_actual: null,
      forecast_contribution: round(contribution),
      forecast_ltv: s.forecast_lifetime_months ? round(contribution * s.forecast_lifetime_months) : null,
      forecast_break_even: contribution > 0 ? Math.ceil((s.fixed_monthly_ils + s.paid_marketing_ils) / contribution) : null,
      scenarios: [100, 500, 1000].map((count) => ({
        customers: count,
        contribution: round(count * contribution),
        surplus: round(count * contribution - s.fixed_monthly_ils - s.paid_marketing_ils),
      })),
      receipts: sales.slice(0, 100),
      products,
      unattributed_sessions: monthlyUsage.filter((r) => !r.customer_id).length,
      notes: [
        "תקבולים כוללים רישום ידני ותשלומי נדרים מאומתים (אסמכתה nedarim:); אינם דוח חשבונאי.",
        "עלות AI משוערת; יתר ההוצאות מוזנות ידנית. אין כאן דוח רווח חשבונאי.",
        "CAC כולל פרסום מוזן ותרגום חינם; אינו כולל זמן עבודה שלא תומחר.",
        "תחזיות מבוססות על הנחות המנהל, לא על נתוני שימור שנמדדו.",
      ],
    };
  }
}
