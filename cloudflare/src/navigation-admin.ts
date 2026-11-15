import type { Env } from "./env";
import { normalizedPhone } from "./business";
import { controlsFromSettings } from "./controls";
import { CustomerSettings } from "./platform";
import { ProgressStore } from "./progress";

export type NavigationMode = "text" | "engine" | "gemini";
export type AdminCommand = { kind: "set"; scope: "self" | "all"; mode: NavigationMode } | { kind: "query" };

export const MODE_NAMES: Record<NavigationMode, string> = { text: "טקסט זול", engine: "מנוע קבוע", gemini: "ג'מיני מדבר" };

export function isAdminPhone(caller: string, admins: string[]): boolean {
  try { const phone = normalizedPhone(caller); return admins.some((a) => { try { return normalizedPhone(a) === phone; } catch { return false; } }); }
  catch { return false; }
}

/** Spoken mode switch for admin callers: "קבע לי מצב טקסט", "קבע לכולם מצב ג'מיני", "איזה מצב פעיל?". */
export function adminCommand(text: string): AdminCommand | null {
  const t = text.replace(/[?!.,״"]/g, " ").replace(/\s+/g, " ").trim();
  if (/(איזה|באיזה|מה ה)\s?מצב/.test(t) && !/מצב (ה)?(תנועה|כביש|דרך|עומס|נסיעה)/.test(t) && !/(קבע|שנה|החלף|העבר|הפעל)/.test(t)) return { kind: "query" };
  if (!/מצב/.test(t) || !/(קבע|שנה|החלף|תחליף|העבר|הפעל|תפעיל|תעביר)/.test(t)) return null;
  const mode: NavigationMode | null = /טקסט/.test(t) ? "text" : /מנוע/.test(t) ? "engine" : /(ג.?מיני|גמיני|gemini|מדבר)/i.test(t) ? "gemini" : null;
  if (!mode) return null;
  return { kind: "set", scope: /(לכולם|לכל|ברירת ה?מחדל|כללי)/.test(t) ? "all" : "self", mode };
}

export async function currentModes(env: Env, profileId: string, customerId: string) {
  const controls = await new ProgressStore(env.DB).loadControls(profileId, controlsFromSettings(false));
  const row = await env.DB.prepare("SELECT body FROM customer_settings WHERE customer_id=?").bind(customerId).first<{ body: string }>();
  let own: string | null = null;
  try { own = CustomerSettings.parse(JSON.parse(row?.body ?? "{}")).navigation_voice; } catch { /* Invalid stored settings mean no override. */ }
  return { all: controls.navigation_voice as NavigationMode, own: own as NavigationMode | null };
}

export async function setMode(env: Env, profileId: string, customerId: string, scope: "self" | "all", mode: NavigationMode) {
  const progress = new ProgressStore(env.DB);
  if (scope === "all") {
    const controls = await progress.loadControls(profileId, controlsFromSettings(false));
    await progress.saveControls(profileId, { ...controls, navigation_voice: mode });
  } else {
    const row = await env.DB.prepare("SELECT body FROM customer_settings WHERE customer_id=?").bind(customerId).first<{ body: string }>();
    let current = CustomerSettings.parse({});
    try { current = CustomerSettings.parse(JSON.parse(row?.body ?? "{}")); } catch { /* Replace invalid settings. */ }
    await env.DB.prepare(`INSERT INTO customer_settings(customer_id,body,updated_at) VALUES(?,?,?)
      ON CONFLICT(customer_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at`)
      .bind(customerId, JSON.stringify({ ...current, navigation_voice: mode }), new Date().toISOString()).run();
  }
  await env.DB.prepare("INSERT INTO console_audit(action,entity_id,created_at) VALUES (?,?,?)")
    .bind(`voice_admin:navigation_voice=${mode}`, scope === "all" ? profileId : customerId, new Date().toISOString()).run();
}
