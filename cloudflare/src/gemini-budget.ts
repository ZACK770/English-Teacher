import { HttpError, type Env } from "./env";

const LEASE_MS = 35_000;
const CHECK_MS = 10_000;
const LOCAL_DEADLINE_MS = 25_000;
const MICROS = 1_000_000;
const FAILURE_STREAK_ALERT = 3;
const FAILURE_STREAK_GAP_MS = 30 * 60_000;
const FAILURE_ALERT_EVERY_MS = 60 * 60_000;
export const BUDGET_GUARD_NAME = "speakcall-v2";

export type BudgetDenial = "system_busy" | "gemini_budget_reached" | "gemini_guard_unavailable";
export const budgetMessage: Record<BudgetDenial, string> = {
  system_busy: "כל קווי השיחה תפוסים כרגע. אפשר לנסות שוב בעוד רגע.",
  gemini_budget_reached: "מכסת השימוש היומית של המערכת הסתיימה. אפשר לחזור מחר.",
  gemini_guard_unavailable: "שירות השיחות אינו זמין כרגע. אפשר לנסות שוב בעוד רגע.",
};

export class GeminiBudgetError extends HttpError {
  constructor(readonly reason: BudgetDenial) {
    super(reason === "gemini_budget_reached" ? 429 : 503, budgetMessage[reason]);
  }
}

function positive(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function budgetConfig(env: Env) {
  return {
    maxJobs: Math.floor(positive(env.GEMINI_MAX_CONCURRENT, 10, 1, 100)),
    daily: Math.round(positive(env.GEMINI_DAILY_BUDGET_USD, 20, 0.01, 100_000) * MICROS),
    perMinute: Math.round(positive(env.GEMINI_RESERVE_USD_PER_MINUTE, 0.15, 0.01, 100) * MICROS),
  };
}

type Limits = ReturnType<typeof budgetConfig>;
type Lease = { until: number; last: number; metered: number; baseMetered: number; floor: number; held: number; paid: boolean };
type Notice = { spent: number; daily: number; blocked: boolean; sent: boolean };
type Ledger = { day: string; spent: number; leases: Record<string, Lease>; notices: Record<string, Notice> };
type Operation = "acquire" | "check" | "release" | "status";
type Outcome = "failure" | "success";
type FailureStreak = { streak: number; first: number; last: number; error: string; alerted_at: number };
const CONFIG_KEYS = ["GEMINI_MAX_CONCURRENT", "GEMINI_DAILY_BUDGET_USD", "GEMINI_RESERVE_USD_PER_MINUTE"] as const;
type GuardConfig = Partial<Record<typeof CONFIG_KEYS[number], string>>;
const guardConfig = (env: Env): GuardConfig => Object.fromEntries(CONFIG_KEYS.filter(key => env[key] !== undefined).map(key => [key, String(env[key])]));

export function applyGeminiOutcome(state: FailureStreak | undefined, now: number, outcome: Outcome, error = "") {
  const next = state ? { ...state } : { streak: 0, first: now, last: now, error: "", alerted_at: 0 };
  if (outcome === "success") return { state: { ...next, streak: 0 }, alert: false };
  if (!next.streak || now - next.last > FAILURE_STREAK_GAP_MS) Object.assign(next, { streak: 0, first: now });
  Object.assign(next, { streak: next.streak + 1, last: now, error: error.slice(0, 200) });
  const alert = next.streak >= FAILURE_STREAK_ALERT && now - next.alerted_at >= FAILURE_ALERT_EVERY_MS;
  if (alert) next.alerted_at = now;
  return { state: next, alert };
}
const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);
const floorCost = (ms: number, limits: Limits) => Math.ceil(ms * limits.perMinute / 60_000);
export const newBudgetLedger = (now: number): Ledger => ({ day: dayOf(now), spent: 0, leases: {}, notices: {} });

function account(state: Ledger, lease: Lease, now: number, limits: Limits, metered = lease.metered) {
  const before = Math.max(lease.metered - lease.baseMetered, lease.floor);
  const elapsed = Math.max(0, now - lease.last);
  const today = Math.max(0, now - Math.max(lease.last, Date.parse(state.day)));
  const delta = Math.max(0, metered - lease.metered);
  if (today < elapsed) lease.baseMetered += Math.floor(delta * (elapsed - today) / elapsed);
  lease.floor += floorCost(today, limits);
  lease.last = now;
  lease.metered = Math.max(lease.metered, metered);
  state.spent += Math.max(lease.metered - lease.baseMetered, lease.floor) - before;
}

function advance(state: Ledger, now: number, limits: Limits) {
  const day = dayOf(now);
  const midnight = Date.parse(day);
  if (state.day !== day) {
    for (const [id, lease] of Object.entries(state.leases)) {
      if (lease.until <= midnight) delete state.leases[id];
      else {
        lease.baseMetered = lease.metered;
        lease.floor = 0;
        lease.held = floorCost(lease.until - midnight, limits);
      }
    }
    state.spent = 0;
    state.day = day;
    for (const date of Object.keys(state.notices)) {
      if (Date.parse(date) < midnight - 7 * 86_400_000) delete state.notices[date];
    }
  }
  for (const [id, lease] of Object.entries(state.leases)) {
    if (lease.until > now) continue;
    state.spent += lease.held;
    delete state.leases[id];
  }
}

export function applyBudget(state: Ledger, now: number, limits: Limits, op: Operation, id = "", observed = 0, paid = false) {
  advance(state, now, limits);
  const lease = state.leases[id];
  let denial: BudgetDenial | undefined;
  if (lease && (op === "check" || op === "release")) {
    account(state, lease, now, limits, observed);
    if (op === "release") delete state.leases[id];
  }
  const othersHeld = Object.entries(state.leases).reduce((sum, [key, slot]) => sum + (key === id ? 0 : slot.held), 0);
  if (op === "check" && !lease) denial = "gemini_guard_unavailable";
  else if (op === "acquire" && Object.keys(state.leases).length >= limits.maxJobs) denial = "system_busy";
  else if (op === "acquire" || op === "check") {
    const held = floorCost(LEASE_MS, limits);
    const paidLease = op === "acquire" ? paid : lease?.paid === true;
    if (!paidLease && state.spent + othersHeld + held > limits.daily) {
      denial = "gemini_budget_reached";
      if (lease) {
        lease.held = floorCost(lease.until - now, limits);
      }
    } else {
      state.leases[id] = { until: now + LEASE_MS, last: now, held, paid: paidLease, metered: lease?.metered ?? 0, baseMetered: lease?.baseMetered ?? 0, floor: lease?.floor ?? 0 };
    }
  }
  if (!state.notices[state.day] && (denial === "gemini_budget_reached" || state.spent >= limits.daily * 0.8)) {
    state.notices[state.day] = { spent: state.spent, daily: limits.daily, blocked: denial === "gemini_budget_reached", sent: false };
  }
  return { denial, day_utc: state.day, estimated_spend_usd: state.spent / MICROS,
    reserved_usd: Object.values(state.leases).reduce((sum, slot) => sum + slot.held, 0) / MICROS,
    active_jobs: Object.keys(state.leases).length, concurrent_limit: limits.maxJobs, daily_budget_usd: limits.daily / MICROS,
    alert_state: state.notices[state.day] ? (state.notices[state.day].sent ? "sent" : "pending") : "not_triggered" };
}

export class GeminiBudget {
  private sending = false;

  constructor(private ctx: DurableObjectState, private env: Env) {}

  fetch = async (request: Request): Promise<Response> => {
    const op = new URL(request.url).pathname.slice(1) as Operation | Outcome;
    let id = "", observed = 0, config: GuardConfig = {};
    const data = request.method === "POST" ? await request.json<{ id?: string; cost?: number; config?: GuardConfig; error?: string; paid?: boolean }>() : {};
    if (data.paid !== undefined && typeof data.paid !== "boolean") return new Response(null, { status: 400 });
    if (data.config && typeof data.config === "object") {
      config = Object.fromEntries(CONFIG_KEYS.filter(key => typeof data.config?.[key] === "string").map(key => [key, data.config![key]]));
    }
    if (op === "failure" || op === "success") return this.recordOutcome(op, typeof data.error === "string" ? data.error : "");
    if (op !== "status") {
      if (!["acquire", "check", "release"].includes(op)) return new Response(null, { status: 404 });
      id = data.id ?? "";
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return new Response(null, { status: 400 });
      if (typeof data.cost === "number" && Number.isFinite(data.cost)) observed = Math.round(Math.max(0, data.cost) * MICROS);
    }
    const now = Date.now();
    const storage = this.ctx.storage;
    const state = storage.kv.get<Ledger>("ledger") ?? newBudgetLedger(now);
    const alreadyNotified = !!state.notices[dayOf(now)];
    const result = applyBudget(state, now, budgetConfig({ ...this.env, ...config }), op, id, observed, data.paid);
    storage.kv.put("ledger", state);
    if ((!alreadyNotified && result.alert_state === "pending") || op === "status") this.ctx.waitUntil(this.sendAlert());
    if (op === "status") {
      console.log(JSON.stringify({ event: "gemini_guard_status", active_jobs: result.active_jobs, concurrent_limit: result.concurrent_limit,
        daily_budget_usd: result.daily_budget_usd, estimated_spend_usd: result.estimated_spend_usd }));
    }
    return Response.json({ ...result, alert_configured: !!(this.env.GEMINI_BUDGET_EMAIL && this.env.GEMINI_BUDGET_EMAIL_TO) });
  };

  private recordOutcome(outcome: Outcome, error: string) {
    const storage = this.ctx.storage.kv;
    const { state, alert } = applyGeminiOutcome(storage.get<FailureStreak>("gemini_failures"), Date.now(), outcome, error);
    storage.put("gemini_failures", state);
    if (alert) this.ctx.waitUntil(this.sendFailureAlert(state));
    return Response.json({ streak: state.streak, alerted: alert });
  }

  private async sendFailureAlert(streak: FailureStreak) {
    const to = this.env.GEMINI_FAILURE_EMAIL_TO || this.env.GEMINI_BUDGET_EMAIL_TO;
    const email = this.env.GEMINI_BUDGET_EMAIL;
    if (!to || !email) return;
    const time = (at: number) => new Date(at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
    try {
      await email.send({
        from: "alerts@speakcall.app", to, subject: "SpeakCall: שיחות נכשלות בגלל שגיאה מ־Gemini",
        text: `${streak.streak} שיחות ברצף נכשלו בגלל שגיאה מ־Gemini (מ־${time(streak.first)} עד ${time(streak.last)}).\n` +
          `השגיאה האחרונה: ${streak.error || "לא ידועה"}\n` +
          "אם כתוב שהקרדיט נגמר (prepayment credits are depleted), צריך להטעין קרדיט ב־AI Studio.\n" +
          "התראה נוספת תישלח לכל היותר פעם בשעה, כל עוד הכשלים נמשכים.",
      });
    } catch {
      console.error("Gemini failure alert delivery failed");
      const latest = this.ctx.storage.kv.get<FailureStreak>("gemini_failures");
      if (latest) this.ctx.storage.kv.put("gemini_failures", { ...latest, alerted_at: 0 });
    }
  }

  private async sendAlert() {
    const to = this.env.GEMINI_BUDGET_EMAIL_TO;
    const email = this.env.GEMINI_BUDGET_EMAIL;
    if (!to || !email || this.sending) return;
    const storage = this.ctx.storage.kv;
    const state = storage.get<Ledger>("ledger");
    const next = Object.entries(state?.notices ?? {}).find(([, notice]) => !notice.sent);
    if (!next) return;
    const [day, notice] = next;
    this.sending = true;
    try {
      await email.send({
        from: "alerts@speakcall.app", to, subject: "SpeakCall: התראת תקציב Gemini",
        text: `תאריך (UTC): ${day}\nהוצאה משוערת: $${(notice.spent / MICROS).toFixed(2)} מתוך $${(notice.daily / MICROS).toFixed(2)}.\n` +
          (notice.blocked ? "לא נותר תקציב זמין לפניות נוספות בזמן ההתראה." : "ההוצאה המשוערת הגיעה ל־80% מהתקרה היומית.") +
          "\nהחישוב כולל שימוש משוער במערכת SpeakCall ואינו החשבון הסופי של Google.",
      });
      const latest = storage.get<Ledger>("ledger");
      if (latest?.notices[day]) {
        latest.notices[day].sent = true;
        storage.put("ledger", latest);
      }
    } catch {
      console.error("Gemini budget alert delivery failed");
    } finally {
      this.sending = false;
    }
  }
}

async function callGuard(env: Env, op: Operation | Outcome, id = "", cost = 0, error?: string, paid?: boolean) {
  const stub = env.GEMINI_BUDGET.getByName(BUDGET_GUARD_NAME, { locationHint: "weur" });
  const request = stub.fetch("https://budget.internal/" + op, {
    method: "POST", body: JSON.stringify({ id, cost, error, paid, config: guardConfig(env) }),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new GeminiBudgetError("gemini_guard_unavailable")), 5000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export const geminiBudgetStatus = (env: Env) => callGuard(env, "status");

export const isGeminiError = (error: unknown) => error instanceof Error && error.message.startsWith("Gemini");

export async function reportGeminiOutcome(env: Env, ok: boolean, error = "") {
  await callGuard(env, ok ? "success" : "failure", "", 0, ok ? undefined : error.slice(0, 200)).catch(() => undefined);
}

export async function acquireGeminiBudget(env: Env, cost: () => number, stop: (reason: BudgetDenial) => void, { paid = false }: { paid?: boolean } = {}) {
  const id = crypto.randomUUID();
  const unavailable = "gemini_guard_unavailable";
  async function check(op: "acquire" | "check") {
    const start = Date.now();
    try {
      const response = await callGuard(env, op, id, cost(), undefined, paid);
      if (!response.ok || Date.now() >= start + LOCAL_DEADLINE_MS) throw new GeminiBudgetError(unavailable);
      const { denial } = await response.json<{ denial?: BudgetDenial }>();
      if (denial) throw new GeminiBudgetError(denial);
      return start;
    } catch (error) {
      if (error instanceof GeminiBudgetError) throw error;
      throw new GeminiBudgetError(unavailable);
    }
  }
  let verified = await check("acquire");
  let closed = false;
  let stopped = false;
  let heartbeat: ReturnType<typeof setTimeout>;
  let deadline: ReturnType<typeof setTimeout>;
  const fail = (reason: BudgetDenial) => {
    if (closed || stopped) return;
    stopped = true;
    clearTimeout(heartbeat);
    clearTimeout(deadline);
    stop(reason);
  };
  const schedule = () => {
    clearTimeout(deadline);
    deadline = setTimeout(() => fail(unavailable), Math.max(0, verified + LOCAL_DEADLINE_MS - Date.now()));
    heartbeat = setTimeout(async () => {
      try {
        const renewed = await check("check");
        if (!closed && !stopped && Date.now() < verified + LOCAL_DEADLINE_MS) {
          verified = renewed;
          schedule();
        }
      } catch (error) {
        fail(error instanceof GeminiBudgetError ? error.reason : unavailable);
      }
    }, CHECK_MS);
  };
  schedule();
  return async () => {
    closed = true;
    clearTimeout(heartbeat);
    clearTimeout(deadline);
    await callGuard(env, "release", id, cost()).catch(() => {});
  };
}
