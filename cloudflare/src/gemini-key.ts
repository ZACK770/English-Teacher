import type { Env } from "./env";

export async function geminiKeyForCall(env: Env, callId: string, adCall = false): Promise<{ key: string; tier: "paid" | "default" }> {
  const fallback = { key: env.GEMINI_API_KEY, tier: "default" as const };
  if (adCall || !env.GEMINI_PAID_TEACHER_API_KEY) return fallback;
  const paid = await env.DB.prepare(`SELECT 1 FROM usage_allocations u
    JOIN sales_receipts r ON r.id=u.receipt_id
    WHERE u.call_id=? AND u.reserved_seconds>0 AND u.billed_seconds IS NULL AND r.amount_ils>0`)
    .bind(callId).first();
  return paid ? { key: env.GEMINI_PAID_TEACHER_API_KEY, tier: "paid" } : fallback;
}
