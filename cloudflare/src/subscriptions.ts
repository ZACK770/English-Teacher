import { z } from "zod";
import { BusinessStore, normalizedPhone } from "./business";
import { type Env, HttpError, randomHex, sha256Hex } from "./env";
import { LearningStore, vocabularyCatalog } from "./learning";
import { disableKeva, enableKeva, updateKevaAmount } from "./nedarim";
import { MASTERY_ID } from "../../src/pricing";

export const DomainSchema = z.object({ domain: z.string(), levels: z.array(z.enum(["beginner", "intermediate", "fluent"])).optional() });
type Domain = z.infer<typeof DomainSchema>;
type Subscription = Record<string, any>;
const DAY = 86400000;
const iso = (at: string | Date) => new Date(at).toISOString().replace("Z", "+00:00");
export function addMonths(at: string, months: number) {
  const d = new Date(at), day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}
const shift = (at: string, ms: number) => iso(new Date(Date.parse(at) + ms));
function yearStart(start: string, at: string) {
  let years = new Date(at).getUTCFullYear() - new Date(start).getUTCFullYear();
  if (addMonths(start, years * 12) > at) years--;
  return addMonths(start, years * 12);
}

export class SubscriptionStore {
  constructor(public db: D1Database, private env?: Env) {}
  private async withBillingLock<T>(id: string, action: (standing: Subscription | null) => Promise<T>) {
    const token = randomHex(16), now = iso(new Date());
    const lock = await this.db.prepare(`INSERT INTO subscription_billing_locks(subscription_id,token,created_at) VALUES (?,?,?)
      ON CONFLICT(subscription_id) DO UPDATE SET token=excluded.token,created_at=excluded.created_at WHERE subscription_billing_locks.created_at<?`)
      .bind(id, token, now, shift(now, -5 * 60000)).run();
    if (!lock.meta.changes) throw new HttpError(409, "עדכון אחר במנוי מתבצע כעת. נסו שוב בעוד רגע.");
    try {
      const standing = await this.db.prepare("SELECT * FROM standing_orders WHERE entitlement_id=? AND state<>'cancelled'").bind(id).first<Subscription>();
      if (standing && (!standing.keva_id || !this.env)) throw new HttpError(409, "יש להשלים את הקמת הוראת הקבע לפני עדכון המנוי.");
      return await action(standing);
    } finally {
      await this.db.prepare("DELETE FROM subscription_billing_locks WHERE subscription_id=? AND token=?").bind(id, token).run();
    }
  }
  private async billingIssue(id: string, kind: string, reference: string) {
    const standing = await this.db.prepare("SELECT first_order_id FROM standing_orders WHERE entitlement_id=?").bind(id).first<{ first_order_id: string }>();
    if (standing) await this.db.prepare("INSERT OR IGNORE INTO payment_issues(id,order_id,kind,message,created_at) VALUES (?,?,?,?,?)")
      .bind((await sha256Hex(kind + ":" + id + ":" + reference)).slice(0, 32), standing.first_order_id, kind, "עדכון הוראת הקבע לא הושלם. יש לבדוק את מצב החיוב בנדרים פלוס ואת מצב המנוי.", iso(new Date())).run();
  }
  async get(id: string): Promise<Subscription> {
    const sub = await this.db.prepare("SELECT * FROM subscriptions WHERE id=?").bind(id).first<Subscription>();
    if (!sub) throw new Error("Subscription not found");
    return sub;
  }
  async list(customerId?: string) {
    return (await this.db.prepare(`SELECT DISTINCT s.* FROM subscriptions s LEFT JOIN subscription_members m ON m.subscription_id=s.id AND m.removed_at IS NULL ${customerId ? "WHERE s.customer_id=? OR m.customer_id=?" : ""} ORDER BY s.created_at DESC`)
      .bind(...(customerId ? [customerId, customerId] : [])).all<Subscription>()).results;
  }
  async create(customerId: string, planId: string, at = new Date().toISOString(), domains?: Domain[], source?: { id: string; priceAgorot: number; monthlyMinutes: number; termMonths: number | null; receiptId?: string; chargeAgorot?: number; vatRate?: number; grantFirstPeriod?: boolean; period?: { number: number; start: string; end: string }; statements?: D1PreparedStatement[] }) {
    at = iso(at);
    const plan = await this.db.prepare("SELECT * FROM plans WHERE id=? AND (active=1 OR ?=1) AND product='school'").bind(planId, source ? 1 : 0).first<Subscription>();
    const pkg = await new BusinessStore(this.db).record("packages", planId);
    if (!plan || !pkg || !(await this.db.prepare("SELECT id FROM customers WHERE id=?").bind(customerId).first())) throw new Error("Unknown customer or plan");
    const term = source ? source.termMonths : pkg.duration_months ?? null;
    const minutes = source?.monthlyMinutes ?? plan.included_minutes;
    if (!source && plan.billing !== "monthly" && !term) throw new Error("Not a subscription plan");
    const selected = z.array(DomainSchema).parse(domains ?? JSON.parse(plan.domains_json));
    if (term && (!selected.length || selected.some(d => !vocabularyCatalog.some(t => t.domain === d.domain && (!d.levels || d.levels.includes(t.level as any)))))) throw new Error("Guarantee domains must have measurable vocabulary");
    if (planId === MASTERY_ID && term && (!source || domains) && !selected.some(d => d.domain !== "everyday")) throw new Error("Choose an additional vocabulary domain for mastery");
    const id = source?.id ?? randomHex(12), end = source?.period?.end ?? addMonths(at, 1);
    await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO subscriptions(id,customer_id,plan_id,status,price_agorot,started_at,current_period_start,current_period_end,created_at,updated_at,term_months,pause_year_start,guarantee_status,domains_json,monthly_minutes,term_end,period_number)
        VALUES (?,?,?,'active',?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, customerId, planId, source?.priceAgorot ?? plan.price_agorot, at, source?.period?.start ?? at, end, at, at, term, at, term ? "pending" : null, JSON.stringify(selected), minutes, term ? addMonths(at, term) : null, source?.period?.number ?? 1),
      ...(source?.grantFirstPeriod === false ? [] : [this.grantStatement({ id, customer_id: customerId, plan_id: planId, monthly_minutes: minutes, current_period_start: at, current_period_end: end, receipt_id: source?.receiptId, charge_agorot: source?.chargeAgorot, vat_rate: source?.vatRate }, at)]),
      ...(source?.statements ?? []),
    ]);
    return this.get(id);
  }
  private grantStatement(sub: Subscription, at: string) {
    return this.db.prepare(`INSERT OR IGNORE INTO sales_receipts(id,customer_id,package_id,product,reference,amount_ils,vat_rate,minutes,expires_at,created_at,subscription_id,valid_from)
      SELECT ?,?,?,'school',?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM subscriptions WHERE id=? AND current_period_start=? AND status IN ('active','paused','past_due'))`).bind(sub.receipt_id ?? randomHex(10), sub.customer_id, sub.plan_id, `subscription:${sub.id}:${sub.current_period_start}`, (sub.charge_agorot ?? 0) / 100, sub.vat_rate ?? 0, sub.monthly_minutes, addMonths(sub.current_period_end, 1), at, sub.id, sub.current_period_start, sub.id, sub.current_period_start);
  }
  async grantPeriod(id: string, at = new Date().toISOString()) {
    const sub = await this.get(id);
    if (sub.status !== "active") throw new Error("Subscription is not active");
    await this.grantStatement(sub, iso(at)).run();
    return this.get(id);
  }
  async renewalAmount(id: string) {
    const sub = await this.get(id);
    const count = await this.db.prepare("SELECT COUNT(*) AS n FROM subscription_members WHERE subscription_id=? AND removed_at IS NULL").bind(id).first<{ n: number }>();
    return sub.price_agorot + sub.family_addon_agorot * (count?.n ?? 0);
  }
  async recordRenewal(id: string, at: string, reference: string, charge?: { amountAgorot: number; vatRate: number; statements?: D1PreparedStatement[] }) {
    if (!reference.trim() || reference.length > 150) throw new Error("Invalid renewal reference");
    const existing = await this.db.prepare("SELECT subscription_id FROM subscription_renewals WHERE reference=?").bind(reference).first<{ subscription_id: string }>();
    if (existing) {
      if (existing.subscription_id !== id) throw new Error("Reference belongs to another subscription");
      return this.get(id);
    }
    const sub = await this.get(id);
    if (!["active", "paused", "past_due"].includes(sub.status)) throw new Error("Subscription is not renewable");
    const start = sub.current_period_end;
    const pausedMs = Date.parse(start) - Date.parse(addMonths(sub.started_at, sub.period_number));
    const end = shift(addMonths(sub.started_at, sub.period_number + 1), pausedMs);
    if (sub.term_months && sub.period_number >= sub.term_months + sub.extension_months) throw new Error("Term has ended");
    try {
      const changes = await this.db.batch([
        this.db.prepare("INSERT INTO subscription_renewals(reference,subscription_id,period_start,created_at) VALUES (?,(SELECT id FROM subscriptions WHERE id=? AND status=? AND current_period_end=?),?,?)").bind(reference, id, sub.status, sub.current_period_end, start, iso(at)),
        this.db.prepare("UPDATE subscriptions SET current_period_start=?,current_period_end=?,period_number=period_number+1,status=CASE WHEN status='past_due' THEN 'active' ELSE status END,resume_status='active',updated_at=? WHERE id=? AND status=? AND current_period_end=? RETURNING id").bind(start, end, iso(at), id, sub.status, sub.current_period_end),
        this.grantStatement({ ...sub, current_period_start: start, current_period_end: end, charge_agorot: charge?.amountAgorot, vat_rate: charge?.vatRate }, iso(at)),
        ...(charge?.statements ?? []),
      ]);
      if (!changes[1].results.length) throw new Error("Subscription status changed");
    } catch (error) {
      const credited = await this.db.prepare("SELECT subscription_id FROM subscription_renewals WHERE reference=?").bind(reference).first<{ subscription_id: string }>();
      if (credited?.subscription_id !== id) throw error;
    }
    return this.get(id);
  }
  async pause(id: string, days: number, at = new Date().toISOString()) {
    return this.withBillingLock(id, async standing => {
      at = iso(at);
      const sub = await this.get(id), year = yearStart(sub.started_at, at);
      const used = sub.pause_year_start === year ? sub.pause_days_used : 0;
      const yearEnd = addMonths(sub.started_at, (new Date(year).getUTCFullYear() - new Date(sub.started_at).getUTCFullYear() + 1) * 12);
      const daysThisYear = Math.min(days, (Date.parse(yearEnd) - Date.parse(at)) / DAY);
      if (sub.status !== "active" || !Number.isInteger(days) || days < 1 || days > 60 || used + daysThisYear > 60) throw new Error("Pause limit exceeded or subscription not active");
      try {
        if (standing) await disableKeva(this.env!, standing.keva_id);
        const changed = await this.db.prepare("UPDATE subscriptions SET status='paused',resume_status='active',paused_at=?,pause_until=?,pause_year_start=?,pause_days_used=?,updated_at=? WHERE id=? AND status='active'").bind(at, shift(at, days * DAY), year, used, at, id).run();
        if (!changed.meta.changes) throw new Error("Subscription status changed");
      } catch (error) {
        if (standing) {
          try {
            await enableKeva(this.env!, standing.keva_id);
          } catch { await this.billingIssue(id, "keva_pause_recovery", at); }
        }
        throw error;
      }
      return this.get(id);
    });
  }
  async resume(id: string, at = new Date().toISOString()) {
    return this.withBillingLock(id, async standing => {
      at = iso(at);
      const sub = await this.get(id);
      if (sub.status !== "paused") throw new Error("Subscription is not paused");
      if (at < sub.paused_at) throw new Error("Resume precedes pause");
      if (standing) {
        let scheduled = false;
        try {
          const nextDate = await enableKeva(this.env!, standing.keva_id);
          await this.db.prepare("UPDATE standing_orders SET next_date=?,updated_at=? WHERE id=?").bind(nextDate, iso(at), standing.id).run();
          scheduled = true;
          return await this.resumeEntitlement(id, at, true, sub);
        } catch (error) {
          try {
            await disableKeva(this.env!, standing.keva_id);
            if (scheduled) await this.db.prepare("UPDATE standing_orders SET next_date=?,updated_at=? WHERE id=?").bind(standing.next_date, standing.updated_at, standing.id).run();
          } catch { await this.billingIssue(id, "keva_resume_recovery", at); }
          throw error;
        }
      }
      return this.resumeEntitlement(id, at, false, sub);
    });
  }
  private async resumeEntitlement(id: string, at: string, billingPaused = false, snapshot?: Subscription) {
    at = iso(at);
    const sub = snapshot ?? await this.get(id);
    if (sub.status !== "paused") throw new Error("Subscription is not paused");
    const until = billingPaused || at < sub.pause_until ? at : sub.pause_until;
    const elapsed = Date.parse(until) - Date.parse(sub.paused_at);
    if (elapsed < 0) throw new Error("Resume precedes pause");
    const year = yearStart(sub.started_at, until);
    const used = (sub.pause_year_start === year ? sub.pause_days_used : 0) + (Date.parse(until) - Date.parse(sub.paused_at > year ? sub.paused_at : year)) / DAY;
    const receipts = (await this.db.prepare("SELECT id,expires_at,valid_from FROM sales_receipts WHERE subscription_id=? AND expires_at>?").bind(id, sub.paused_at).all<Subscription>()).results;
    const changes = await this.db.batch([
      ...receipts.map(r => this.db.prepare("UPDATE sales_receipts SET expires_at=?,valid_from=? WHERE id=? AND EXISTS (SELECT 1 FROM subscriptions WHERE id=? AND status='paused' AND paused_at=? AND current_period_end=?)").bind(shift(r.expires_at, elapsed), r.valid_from && r.valid_from > sub.paused_at ? shift(r.valid_from, elapsed) : r.valid_from, r.id, id, sub.paused_at, sub.current_period_end)),
      this.db.prepare("UPDATE subscriptions SET status=resume_status,current_period_start=?,current_period_end=?,term_end=?,paused_at=NULL,pause_until=NULL,pause_year_start=?,pause_days_used=?,updated_at=? WHERE id=? AND status='paused' AND paused_at=? AND current_period_end=? RETURNING id").bind(sub.current_period_start > sub.paused_at ? shift(sub.current_period_start, elapsed) : sub.current_period_start, shift(sub.current_period_end, elapsed), sub.term_end ? shift(sub.term_end, elapsed) : null, year, used, at, id, sub.paused_at, sub.current_period_end),
    ]);
    if (!changes[changes.length - 1].results.length) throw new Error("Subscription status changed");
    return this.get(id);
  }
  async cancel(id: string, at = new Date().toISOString()) {
    let sub = await this.get(id);
    if (sub.status === "cancelled") return sub;
    if (sub.status === "paused") sub = await this.resumeEntitlement(id, at);
    const changed = await this.db.prepare("UPDATE subscriptions SET status='cancelled',cancelled_at=?,updated_at=? WHERE id=? AND status=?").bind(iso(at), iso(at), id, sub.status).run();
    if (!changed.meta.changes) throw new Error("Subscription status changed");
    return this.get(id);
  }
  async evaluateGuarantee(id: string, at = new Date().toISOString()) {
    const sub = await this.get(id);
    if (!sub.term_months || sub.guarantee_status !== "pending") return sub;
    if (sub.status !== "active" || iso(at) < sub.term_end) throw new Error("Guarantee is not due");
    const report = await new LearningStore(this.db).report(sub.customer_id);
    const domains: Domain[] = JSON.parse(sub.domains_json);
    const scores = domains.map(d => {
      const pool = vocabularyCatalog.filter(t => t.domain === d.domain && (!d.levels || d.levels.includes(t.level as any)));
      const ids = new Set(pool.map(t => t.id));
      return pool.length ? report.items.filter(t => t.kind === "vocabulary" && ids.has(t.id) && t.mastered).length / pool.length * 100 : null;
    });
    if (!scores.length || scores.some(s => s === null)) throw new Error("No measurable guarantee targets");
    const granted = scores.reduce<number>((n, s) => n + s!, 0) / scores.length < 70;
    await this.db.prepare("UPDATE subscriptions SET guarantee_status=?,guarantee_evaluated_at=?,extension_months=?,term_end=?,updated_at=? WHERE id=? AND guarantee_status='pending'")
      .bind(granted ? "granted" : "not_eligible", iso(at), granted ? 3 : 0, granted ? addMonths(sub.term_end, 3) : sub.term_end, iso(at), id).run();
    return this.get(id);
  }
  async addMember(id: string, phone: string, name: string) {
    return this.withBillingLock(id, async standing => {
      const customerId = await new BusinessStore(this.db).customerForPhone(normalizedPhone(phone));
      const previous = customerId ? await this.db.prepare("SELECT * FROM subscription_members WHERE subscription_id=? AND customer_id=?").bind(id, customerId).first<Subscription>() : null;
      const result = await this.addMemberEntitlement(id, phone, name);
      await this.syncFamilyAmount(id, result.customer_id, previous, standing);
      return result;
    });
  }
  private async addMemberEntitlement(id: string, phone: string, name: string) {
    const sub = await this.get(id), b = new BusinessStore(this.db);
    if (sub.status !== "active" || !name.trim()) throw new Error("Active subscription and member name required");
    phone = normalizedPhone(phone);
    let customerId = await b.customerForPhone(phone);
    if (customerId === sub.customer_id) throw new Error("Owner cannot be a member");
    if (!customerId) customerId = (await b.save("customers", { name, phone, source: "family" })).id;
    const result = await this.db.prepare(`INSERT INTO subscription_members SELECT ?,?,?,NULL WHERE
      (SELECT COUNT(*) FROM subscription_members WHERE subscription_id=? AND removed_at IS NULL)<4
      AND NOT EXISTS (SELECT 1 FROM subscription_members m JOIN subscriptions s ON s.id=m.subscription_id WHERE m.customer_id=? AND m.removed_at IS NULL AND s.status IN ('active','paused'))
      ON CONFLICT(subscription_id,customer_id) DO UPDATE SET removed_at=NULL,added_at=excluded.added_at`)
      .bind(id, customerId, new Date().toISOString(), id, customerId).run();
    if (!result.meta.changes) throw new Error("Family limit reached or customer already a member");
    return { customer_id: customerId };
  }
  async removeMember(id: string, customerId: string) {
    return this.withBillingLock(id, async standing => {
      await this.get(id);
      const previous = await this.db.prepare("SELECT * FROM subscription_members WHERE subscription_id=? AND customer_id=? AND removed_at IS NULL").bind(id, customerId).first<Subscription>();
      if (!previous) return;
      await this.db.prepare("UPDATE subscription_members SET removed_at=? WHERE subscription_id=? AND customer_id=? AND removed_at IS NULL").bind(new Date().toISOString(), id, customerId).run();
      await this.syncFamilyAmount(id, customerId, previous, standing);
    });
  }
  private async syncFamilyAmount(id: string, customerId: string, previous: Subscription | null, standing: Subscription | null) {
    if (!standing) return;
    try {
      const amount = await this.renewalAmount(id);
      await updateKevaAmount(this.env!, standing.keva_id, amount);
      await this.db.prepare("UPDATE standing_orders SET previous_monthly_agorot=monthly_agorot,monthly_agorot=?,updated_at=? WHERE id=?").bind(amount, iso(new Date()), standing.id).run();
    } catch {
      await this.db.batch([
        previous ? this.db.prepare(`UPDATE subscription_members SET added_at=?,removed_at=? WHERE subscription_id=? AND customer_id=?
          AND (? IS NOT NULL OR NOT EXISTS (SELECT 1 FROM subscription_members m JOIN subscriptions s ON s.id=m.subscription_id
            WHERE m.customer_id=? AND m.subscription_id<>? AND m.removed_at IS NULL AND s.status IN ('active','paused')))`)
          .bind(previous.added_at, previous.removed_at, id, customerId, previous.removed_at, customerId, id)
          : this.db.prepare("DELETE FROM subscription_members WHERE subscription_id=? AND customer_id=?").bind(id, customerId),
        this.db.prepare("UPDATE standing_orders SET monthly_agorot=?,previous_monthly_agorot=? WHERE id=?").bind(standing.monthly_agorot, standing.previous_monthly_agorot, standing.id),
      ]);
      const restored = previous ? await this.db.prepare("SELECT removed_at FROM subscription_members WHERE subscription_id=? AND customer_id=?").bind(id, customerId).first<Subscription>() : null;
      const conflict = previous && restored?.removed_at !== previous.removed_at;
      if (conflict) await this.billingIssue(id, "keva_family_membership_conflict", customerId);
      try {
        const amount = conflict ? await this.renewalAmount(id) : standing.monthly_agorot;
        await updateKevaAmount(this.env!, standing.keva_id, amount);
        if (conflict) await this.db.prepare("UPDATE standing_orders SET monthly_agorot=? WHERE id=?").bind(amount, standing.id).run();
      }
      catch { await this.billingIssue(id, "keva_family_recovery", iso(new Date())); }
      throw new HttpError(502, "עדכון החיוב בנדרים פלוס נכשל. השינוי בבני המשפחה בוטל, נסו שוב או פנו לשירות.");
    }
  }
  async summary(customerId: string, at = new Date().toISOString()) {
    return Promise.all((await this.list(customerId)).map(async sub => {
      const rollover = (await this.db.prepare(`SELECT r.expires_at,MAX(0,r.minutes*60-COALESCE((SELECT SUM(COALESCE(u.billed_seconds,u.reserved_seconds)) FROM usage_allocations u WHERE u.receipt_id=r.id),0))/60.0 AS minutes FROM sales_receipts r WHERE r.subscription_id=? AND COALESCE(r.valid_from,r.created_at)<? AND r.expires_at>? ORDER BY r.expires_at`)
        .bind(sub.id, sub.current_period_start, sub.status === "paused" ? sub.paused_at : iso(at)).all<{ expires_at: string; minutes: number }>()).results.filter(r => r.minutes > 0);
      const plan = await this.db.prepare("SELECT name FROM plans WHERE id=?").bind(sub.plan_id).first<{ name: string }>();
      const members = (await this.db.prepare("SELECT m.customer_id,c.name,c.primary_phone AS phone FROM subscription_members m JOIN customers c ON c.id=m.customer_id WHERE m.subscription_id=? AND m.removed_at IS NULL").bind(sub.id).all()).results;
      const year = yearStart(sub.started_at, iso(at));
      const ongoing = sub.status === "paused" ? Math.max(0, (Date.parse(iso(at) < sub.pause_until ? iso(at) : sub.pause_until) - Date.parse(sub.paused_at > year ? sub.paused_at : year)) / DAY) : 0;
      const { notes, ...publicSub } = sub;
      return { ...publicSub, plan_name: plan?.name ?? sub.plan_id, members, owner: sub.customer_id === customerId, renewal_amount_agorot: await this.renewalAmount(sub.id), rollover_minutes: rollover.reduce((sum, r) => sum + r.minutes, 0), rollover, pause_days_remaining: Math.max(0, 60 - (sub.pause_year_start === year ? sub.pause_days_used : 0) - ongoing) };
    }));
  }
  async tick(at = new Date().toISOString()) {
    at = iso(at);
    for (let sub of await this.list()) {
      try {
        if (sub.status === "paused" && sub.pause_until <= at) {
          try { sub = await this.resume(sub.id, at); }
          catch {
            await this.billingIssue(sub.id, "keva_auto_resume", sub.paused_at);
            continue;
          }
        }
        if (sub.status !== "active" || !sub.term_months) continue;
        if (sub.guarantee_status === "pending" && sub.term_end <= at) sub = await this.evaluateGuarantee(sub.id, at);
        while (sub.current_period_end <= at && sub.period_number < sub.term_months + sub.extension_months) {
          sub = await this.recordRenewal(sub.id, at, `mastery:${sub.id}:${sub.current_period_end}`);
        }
      } catch { /* Continue processing independent subscriptions. */ }
    }
  }
}
