import { vocabularyDomains } from "./learning";

export const MASTERY_DOMAIN_TOOL = {
  name: "save_mastery_domain",
  description: "Save the additional Master vocabulary domain explicitly chosen by the learner.",
  parameters: { type: "object", properties: { domain: { type: "string", enum: vocabularyDomains.filter(domain => domain !== "everyday") } }, required: ["domain"] },
};

async function pendingDomain(db: D1Database, customerId: string, now: Date) {
  if (!customerId || customerId.startsWith("anonymous-")) return null;
  const row = await db.prepare(`SELECT s.id,s.domains_json,s.started_at FROM subscriptions s
    JOIN payment_orders p ON p.entitlement_id=s.id
    WHERE s.customer_id=? AND s.term_months=12 AND s.status='active' AND s.access_suspended_at IS NULL
      AND julianday(s.current_period_start)<=julianday(?) AND julianday(s.current_period_end)>julianday(?)
      AND p.channel='phone' AND p.state='paid' AND json_extract(p.snapshot,'$.guarantee_domain') IS NULL
    ORDER BY s.started_at DESC LIMIT 1`).bind(customerId, now.toISOString(), now.toISOString())
    .first<{ id: string; domains_json: string; started_at: string }>();
  if (!row || JSON.parse(row.domains_json).some((domain: { domain: string }) => domain.domain !== "everyday")) return null;
  return row;
}

export async function masteryDomainGuidance(db: D1Database, customerId: string, now = new Date()): Promise<string | null> {
  const sub = await pendingDomain(db, customerId, now);
  if (!sub) return null;
  const prior = await db.prepare(`SELECT 1 FROM sessions s JOIN call_customers c ON c.call_id=s.call_id JOIN bots b ON b.id=c.bot_id
    WHERE s.student_id=? AND b.role='teacher' AND julianday(s.started_at)>=julianday(?) LIMIT 1`).bind(customerId, sub.started_at).first();
  if (prior) return null;
  return 'This is the first lesson after a phone Master purchase. Ask once naturally in gender-neutral Hebrew: "באיזה תחום הכי חשוב לך להתחזק?" Explain briefly that Master includes an additional vocabulary domain of their choice. Call save_mastery_domain only with the domain the learner chooses; clarify if unclear. Do not choose for them or require a confirmation phrase. If they decline, continue the lesson with the existing default and do not ask again.';
}

export async function saveMasteryDomain(db: D1Database, customerId: string, domain: unknown, now = new Date()): Promise<boolean> {
  if (typeof domain !== "string" || domain === "everyday" || !vocabularyDomains.includes(domain)) return false;
  const sub = await pendingDomain(db, customerId, now);
  if (!sub) return false;
  const domains = JSON.stringify([...JSON.parse(sub.domains_json), { domain }]);
  await db.batch([
    db.prepare("UPDATE subscriptions SET domains_json=?,updated_at=? WHERE id=? AND customer_id=? AND domains_json=?")
      .bind(domains, now.toISOString(), sub.id, customerId, sub.domains_json),
    db.prepare(`UPDATE payment_orders SET snapshot=json_set(snapshot,'$.guarantee_domain',?),updated_at=?
      WHERE entitlement_id=? AND customer_id=? AND channel='phone' AND state='paid'
        AND EXISTS(SELECT 1 FROM subscriptions WHERE id=? AND domains_json=?)`)
      .bind(domain, now.toISOString(), sub.id, customerId, sub.id, domains),
  ]);
  return !!await db.prepare("SELECT 1 FROM subscriptions WHERE id=? AND customer_id=? AND domains_json=?").bind(sub.id, customerId, domains).first();
}
