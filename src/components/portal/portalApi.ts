import type { SubscriptionSummary } from "./SubscriptionPanel";
import { clearLearnerToken, readLearnerToken, saveLearnerToken } from "./learnerToken";
export type Plan = { goal: string; level: string; difficulty: string; minutes: number; topic: string };
export type LessonSettings = { level?: string; conversation_mode?: string; learning_load?: string; correction_policy?: string; closing_activity?: string };
export type Teacher = LessonSettings & { id: string; name: string; base_bot: string; personality: string; voice: string; explanation: string; pace: string; corrections: string; topic: string; material_id: string };
export type Material = { id: string; name: string; words: string[]; target_count?: number };
export type Preferences = LessonSettings & { learner_name?: string; selected_bot?: string; active_teacher?: string; pace?: string; corrections?: string; minutes?: number; language?: string; track?: string; topic?: string; material_id?: string; store_transcripts?: boolean; plan?: Plan; mode?: string; grammar_targets?: string[] };
export type Lesson = { call_id: string; started_at: string; duration_seconds: number; summary_he: string; success_he: string; next_step_he: string; points: number; observations: { skill: string; result: string; correction: string; score: number }[] };
export type Account = {
  subscriptions?: SubscriptionSummary[];
  customer: { id: string; name: string; phone: string; preferred_bot: string };
  bots: { id: string; label: string; role: string; phone_enabled: boolean }[];
  teachers: Teacher[]; materials: Material[]; preferences: Preferences; phone: string; extension: string;
  phones: { id: string; phone: string }[];
  receipts: { id: string; minutes: number; spent_seconds: number; product: string; expires_at: string; created_at: string; valid_from?: string | null }[];
  access?: { limited: boolean; opening_minutes?: number; free_calls_left: number; free_call_minutes: number; plan_name: string; max_call_minutes: number };
  progress: { session_count: number; total_minutes: number; total_points: number; average_score: number | null; skill_averages: Record<string, number>; sessions: Lesson[] };
};
export const topics: Record<string, string> = { recommended: "המומלץ בשבילך", everyday: "חיי היום־יום", travel: "טיולים בחו״ל", business: "עבודה ועסקים", flights: "טיסות", medicine: "רפואה", academic: "לימודים", property: "נדל״ן", cars: "רכב",
  career: "קריירה ועבודה",
  school: "בית ספר ונוער" };
export const tracks: Record<string, string> = { recommended: "המומלץ בשבילך", conversation: "שיחה", spelling: "איות", grammar: "דקדוק" };
export const apiPrefix = location.pathname === "/english" || location.pathname.startsWith("/english/") ? "/english" : "";
export class PortalError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function portalRequest<T>(path: string, token: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(apiPrefix + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    if (response.status === 401 && path.startsWith("/v1/portal/") && !path.startsWith("/v1/portal/auth/") && token && token === readLearnerToken()) clearLearnerToken();
    throw new PortalError(json?.detail || "לא הצלחנו להתחבר. ננסה שוב?", response.status);
  }
  return json as T;
}
export function initialToken() {
  let hash = "";
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch { return readLearnerToken(); }
  if (/^[A-Za-z0-9_-]{30,128}$/.test(hash)) {
    saveLearnerToken(hash);
    history.replaceState(null, "", location.pathname);
    return hash;
  }
  return readLearnerToken();
}
export async function resumeLearnerSession(): Promise<boolean> {
  const token = initialToken();
  if (!token) return false;
  try {
    await portalRequest<Account>("/v1/portal/me", token);
    return readLearnerToken() === token;
  } catch {
    return false;
  }
}
export function remainingMinutes(account: Account) {
  return Math.max(0, Math.floor(account.receipts.filter(r => r.product === "school" && new Date(r.expires_at).getTime() > Date.now() && (!r.valid_from || new Date(r.valid_from).getTime() <= Date.now())).reduce((n, r) => n + Math.max(0, r.minutes * 60 - r.spent_seconds), 0) / 60));
}
export function futureMinutes(account: Account) {
  return Math.max(0, Math.floor(account.receipts.filter(r => r.product === "school" && new Date(r.expires_at).getTime() > Date.now() && r.valid_from && new Date(r.valid_from).getTime() > Date.now()).reduce((n, r) => n + Math.max(0, r.minutes * 60 - r.spent_seconds), 0) / 60));
}
export function practiceDays(sessions: Lesson[]) {
  return new Set(sessions.filter(s => s.duration_seconds >= 30).map(s => new Date(s.started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }))).size;
}
