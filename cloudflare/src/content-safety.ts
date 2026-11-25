import { b64encode, concat, wav } from "./audio";
import { normalizedPhone } from "./business";
import { type Env, HttpError } from "./env";
import { CONTENT_SUSPENDED_MESSAGE, CONTENT_BLOCKED_MESSAGE } from "../../src/contentSafetyCopy";

export const STRIKE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const GLOBAL = "teachers";
const MAX_TRANSCRIPT = 8192;
const MAX_CLIP_BYTES = 24_000 * 2 * 18;
const MODEL = "@cf/openai/whisper-large-v3-turbo";
type Policy = { tutor: string[]; learner: string[]; critical: string[] };
type Hold = {
  incident_id: string;
  reason: "tutor" | "learner" | "critical";
  created_ms: number;
  alert_state: "pending" | "sending" | "accepted" | "failed" | null;
};
type AdminIdentity = { username: string; role: "owner" | "staff"; bearer?: boolean };

const canonical = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\p{M}/gu, "");
const words = (value: string) => canonical(value).match(/[\p{L}\p{N}]+/gu) ?? [];
const phrase = (value: string) => words(value).join(" ");

export function contentPolicy(env: Env): Policy | null {
  if (env.CONTENT_SAFETY_MODE !== "on") return null;
  try {
    const value = JSON.parse(env.CONTENT_SAFETY_LISTS ?? "") as Partial<Policy>;
    function list(name: keyof Policy) {
      const entries = value[name];
      if (!Array.isArray(entries) || !entries.length || entries.length > 300
        || entries.some(term => typeof term !== "string" || term.length > 100 || !phrase(term))) {
        throw new Error("invalid list");
      }
      return [...new Set(entries.map(phrase))];
    }
    const tutor = list("tutor"), learner = list("learner"), critical = list("critical");
    if (critical.some(term => !tutor.includes(term)) || !alertNumbers(env) || !env.AI || !env.TLIVR_SYSTEM_API_KEY) throw new Error("invalid configuration");
    return { tutor, learner, critical };
  } catch {
    throw new ContentSafetyError("content_suspended");
  }
}

export function matchedTerms(text: string, list: string[], complete = true): string[] {
  const tokens = words(text);
  if (!complete && /[\p{L}\p{N}]$/u.test(canonical(text))) tokens.pop();
  const normalized = ` ${tokens.join(" ")} `;
  return list.filter(term => normalized.includes(` ${term} `));
}

export class ContentTurn {
  private tutor = "";
  private learner = "";
  private tutorFinished = false;
  private learnerFinished = false;
  private audio: Uint8Array[] = [];
  private bytes = 0;

  constructor(readonly policy: Policy) {}

  transcript(role: "tutor" | "learner", raw: string, finished = false) {
    const text = this[role] + raw;
    this[role] = text.length > MAX_TRANSCRIPT ? text.slice(-MAX_TRANSCRIPT).replace(/^\S*/, "") : text;
    if (role === "learner") this.learnerFinished ||= finished;
    else this.tutorFinished ||= finished;
    return role === "tutor" && matchedTerms(this.tutor, this.policy.tutor, finished).length > 0;
  }

  criticalCandidate(finished = false) {
    return matchedTerms(this.tutor, this.policy.critical, finished).length > 0;
  }

  tutorAudio(data: Uint8Array) {
    if (!data.length) return;
    const chunk = data.subarray(Math.max(0, data.length - MAX_CLIP_BYTES));
    this.audio.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > MAX_CLIP_BYTES) this.bytes -= this.audio.shift()!.length;
  }

  finish(complete = true) {
    const tutorComplete = complete || this.tutorFinished;
    const critical = matchedTerms(this.tutor, this.policy.critical, tutorComplete);
    const result = {
      tutor: matchedTerms(this.tutor, this.policy.tutor, tutorComplete).length > 0,
      learner: matchedTerms(this.learner, this.policy.learner, complete || this.learnerFinished).length > 0,
      critical,
      audio: critical.length ? concat(this.audio) : new Uint8Array(),
    };
    this.learner = "";
    this.learnerFinished = false;
    this.interrupt();
    return result;
  }

  interrupt() {
    this.tutor = "";
    this.tutorFinished = false;
    this.audio = [];
    this.bytes = 0;
  }
}

export type ContentDenial = "content_blocked" | "content_suspended";
export const contentDenialMessage = (reason: ContentDenial) =>
  reason === "content_blocked" ? CONTENT_BLOCKED_MESSAGE : CONTENT_SUSPENDED_MESSAGE;

export class ContentSafetyError extends HttpError {
  constructor(readonly reason: ContentDenial) {
    super(reason === "content_blocked" ? 403 : 503, contentDenialMessage(reason));
  }
}

export class ContentSafetyStore {
  constructor(private db: D1Database) {}

  async denied(customer: string): Promise<ContentDenial | null> {
    const hold = await this.db.prepare(`SELECT subject_id FROM content_safety_holds WHERE subject_id IN (?,?)
      ORDER BY subject_id = ? DESC LIMIT 1`).bind(customer, GLOBAL, customer).first<string>("subject_id");
    return hold === customer ? "content_blocked" : hold === GLOBAL ? "content_suspended" : null;
  }

  async strike(customer: string, eventId: string, now = Date.now()) {
    if (customer.startsWith("anonymous-")) return false;
    const [, , result] = await this.db.batch([
      this.db.prepare("INSERT INTO content_safety_strikes VALUES (?,?,?) ON CONFLICT DO NOTHING").bind(eventId, customer, now),
      this.db.prepare(`INSERT INTO content_safety_holds (subject_id,incident_id,reason,created_ms)
        SELECT ?,?,'learner',? WHERE (SELECT COUNT(*) FROM content_safety_strikes WHERE customer_id=? AND created_ms>=?) >= 3
        ON CONFLICT (subject_id) DO NOTHING`).bind(customer, crypto.randomUUID(), now, customer, now - STRIKE_WINDOW_MS),
      this.db.prepare("SELECT subject_id FROM content_safety_holds WHERE subject_id=?").bind(customer),
    ]);
    return result.results.length > 0;
  }

  async block(customer: string) {
    await this.db.prepare(`INSERT INTO content_safety_holds (subject_id,incident_id,reason,created_ms)
      VALUES (?,?,'tutor',?) ON CONFLICT (subject_id) DO NOTHING`).bind(customer, crypto.randomUUID(), Date.now()).run();
  }

  async suspend() {
    return this.db.prepare(`INSERT INTO content_safety_holds (subject_id,incident_id,reason,created_ms,alert_state)
      VALUES (?,?, 'critical',?,'pending') ON CONFLICT (subject_id) DO NOTHING RETURNING incident_id`)
      .bind(GLOBAL, crypto.randomUUID(), Date.now()).first<string>("incident_id");
  }

  async status(customer: string | null) {
    const held = (subject: string) => this.db.prepare(`SELECT incident_id,reason,created_ms,alert_state
      FROM content_safety_holds WHERE subject_id=?`).bind(subject).first<Hold>();
    const [teacher, user] = await Promise.all([held(GLOBAL), customer ? held(customer) : null]);
    return { teacher, customer: user };
  }

  async restore(incident: string) {
    const [, deleted] = await this.db.batch([
      this.db.prepare(`DELETE FROM content_safety_strikes WHERE customer_id IN
        (SELECT subject_id FROM content_safety_holds WHERE incident_id=? AND reason!='critical')`).bind(incident),
      this.db.prepare("DELETE FROM content_safety_holds WHERE incident_id=?").bind(incident),
    ]);
    return (deleted.meta.changes ?? 0) === 1;
  }
}

function alertNumbers(env: Env) {
  try {
    if (!env.CONTENT_SAFETY_ALERT_TO || !env.CONTENT_SAFETY_ALERT_FROM) return null;
    return { to: normalizedPhone(env.CONTENT_SAFETY_ALERT_TO), from: normalizedPhone(env.CONTENT_SAFETY_ALERT_FROM) };
  } catch { return null; }
}

export async function verifyCriticalAudio(env: Env, audio: Uint8Array, critical: string[]): Promise<boolean> {
  if (!env.AI || !critical.length || !audio.length) return false;
  try {
    const result = await env.AI.run(MODEL, {
      audio: b64encode(wav(audio, 24000)), task: "transcribe", vad_filter: true,
      condition_on_previous_text: false, log_prob_threshold: -0.5, no_speech_threshold: 0.15,
    });
    let verified = "";
    for (const segment of result.segments ?? []) {
      if (segment.text && typeof segment.avg_logprob === "number" && segment.avg_logprob >= -0.5
        && typeof segment.no_speech_prob === "number" && segment.no_speech_prob <= 0.15) {
        verified += " " + segment.text;
        if (matchedTerms(verified, critical).length) return true;
      } else verified = "";
    }
    return false;
  } catch {
    console.warn("Tutor audio verification failed");
    return false;
  }
}

export async function confirmCriticalIncident(env: Env, audio: Uint8Array, critical: string[]) {
  if (!await verifyCriticalAudio(env, audio, critical)) return;
  const incident = await new ContentSafetyStore(env.DB).suspend();
  if (incident) await dispatchContentAlert(env, incident);
}

export async function dispatchContentAlert(env: Env, incident?: string) {
  if (env.CONTENT_SAFETY_MODE !== "on") return;
  const numbers = alertNumbers(env);
  if (!env.TLIVR_SYSTEM_API_KEY || !numbers) return;
  const id = await env.DB.prepare(`UPDATE content_safety_holds SET alert_state='sending'
    WHERE subject_id=? AND alert_state='pending' AND (? IS NULL OR incident_id=?) RETURNING incident_id`)
    .bind(GLOBAL, incident ?? null, incident ?? null).first<string>("incident_id");
  if (!id) return;
  let state = "failed";
  try {
    const response = await fetch("https://api.tlivr.com/campaignApi.php", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "speakcall-content-alert/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        action: "campaignRun", apiKey: env.TLIVR_SYSTEM_API_KEY, phones: [numbers.to], callId: numbers.from,
        title: "אזעקת סינון ספיקול", messagesType: "audioFile",
        audioText: "אזעקת סינון. המורה הושעה לכל המשתמשים. נא לבדוק את מערכת הניהול.",
        externalID: `safety-${id}`, dialRetries: 0, reasonableHours: "no",
      }),
    });
    const result = await response.json<{ status?: string; errorCode?: string | number }>();
    if (response.ok && result.status?.toUpperCase() === "OK" && String(result.errorCode) === "0") state = "accepted";
  } catch {
    // An ambiguous provider response must not trigger a second call.
  }
  await env.DB.prepare("UPDATE content_safety_holds SET alert_state=? WHERE incident_id=?").bind(state, id).run();
}

export async function cleanupContentSafety(env: Env) {
  if (env.CONTENT_SAFETY_MODE !== "on") return;
  await env.DB.prepare("DELETE FROM content_safety_strikes WHERE created_ms<?").bind(Date.now() - STRIKE_WINDOW_MS).run();
  await dispatchContentAlert(env);
}

export async function adminContentSafety(request: Request, env: Env, path: string, identity: AdminIdentity) {
  const base = "/v1/admin/crm/content-safety";
  if (path !== base && path !== base + "/restore") return null;
  const owner = identity.role === "owner" && !identity.bearer && identity.username === (env.CONTENT_SAFETY_OWNER || "owner");
  if (!owner) throw new HttpError(403, "אין הרשאה לפעולה זו.");
  const headers = { "Cache-Control": "no-store" };
  if (env.CONTENT_SAFETY_MODE !== "on") return Response.json({ enabled: false }, { headers });
  const store = new ContentSafetyStore(env.DB);
  if (path === base && request.method === "GET") {
    return Response.json({ enabled: true, ...await store.status(new URL(request.url).searchParams.get("customer_id")) }, { headers });
  }
  if (path === base + "/restore" && request.method === "POST") {
    const data = await request.json<{ incident_id?: string }>().catch(() => null);
    if (typeof data?.incident_id !== "string" || !/^[0-9a-f-]{36}$/.test(data.incident_id)) throw new HttpError(422, "מזהה החסימה שגוי.");
    if (!await store.restore(data.incident_id)) throw new HttpError(409, "החסימה כבר אינה פעילה.");
    return Response.json({ restored: true }, { headers });
  }
  throw new HttpError(405, "הפעולה אינה זמינה.");
}
