import { z } from "zod";
import { BusinessStore } from "./business";
import { type Env, nowIso, randomHex, sha256Hex, type Settings } from "./env";
import { enqueueLessonCallback, followupLessonTime, SPEAKCALL_PHONE, tomorrowAt } from "./callbacks";
import { DEFAULT_TEACHER_NAME, PHONE_SIGNUP_NAME, PlanSchema } from "./learner";
import { ProgressStore } from "./progress";
import { startSchool, type IVRResponse } from "./pbx";
import { qaCustomerIds } from "./qa-customers";

export const AD_ENTRIES = "ad-entries";
export const SALES_FOLLOWUPS = "sales-followups";
export const DEFAULT_CAMPAIGN = "general";
export const SALES_SITE = "https://speakool.net";
export const SALES_SENDER = "noreply@speakcall.app";

export const SALES_PLANS = {
  "school-step": { name: "צעד", price: "59 ש\"ח לחודש" },
  "school-pace": { name: "בקצב", price: "119 ש\"ח לחודש" },
  "school-fluent": { name: "שוטף", price: "199 ש\"ח לחודש" },
  "school-foundations": { name: "יסודות", price: "690 ש\"ח" },
  "school-mastery": { name: "שליטה מלאה", price: "1,490 ש\"ח" },
} as const;
type PlanId = keyof typeof SALES_PLANS;
const PLAN_IDS = Object.keys(SALES_PLANS) as [PlanId, ...PlanId[]];

export function campaignName(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return value || DEFAULT_CAMPAIGN;
}

export async function startAdEntry(b: BusinessStore, progress: ProgressStore, s: Settings, callId: string, customerId: string, campaign: unknown): Promise<IVRResponse> {
  const context = await b.loadContext(callId);
  const name = campaignName(campaign);
  if (context.entry !== "ad") {
    const saved = await b.loadContext("preferences:" + customerId);
    const newCaller = !PlanSchema.safeParse(saved.plan).success;
    await b.saveContext(callId, { entry: "ad", campaign: name, ad_new_caller: newCaller });
    if (!saved.ad_campaign) await b.savePreference(customerId, { ad_campaign: name });
    await b.save(AD_ENTRIES, { call_id: callId, customer_id: customerId, campaign: name, new_caller: newCaller, at: nowIso() }, randomHex(16));
  }
  return startSchool(b, progress, s, callId, customerId);
}

export async function registerPirsumfonEntry(b: BusinessStore, callId: string, customerId: string, campaign: unknown) {
  const name = campaignName(campaign || "pirsumfon");
  const saved = await b.loadContext("preferences:" + customerId);
  const newCaller = !PlanSchema.safeParse(saved.plan).success;
  if (!saved.ad_campaign || (newCaller && !saved.pirsumfon_campaign)) {
    await b.savePreference(customerId, {
      ad_campaign: saved.ad_campaign || name,
      ...(newCaller && !saved.pirsumfon_campaign ? { pirsumfon_campaign: name } : {}),
    });
  }
  const entryId = "pirsumfon-" + await sha256Hex(callId);
  const at = nowIso();
  await b.db.prepare("INSERT OR IGNORE INTO console_records (kind, id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(AD_ENTRIES, entryId, JSON.stringify({ call_id: callId, customer_id: customerId, campaign: name, new_caller: newCaller, at }), at, at).run();
}

export function adOpening(context: Record<string, any>): string | null {
  if (context.entry !== "ad") return null;
  if (context.ad_new_caller) {
    if (context.pirsumfon_sales) {
      return "This is the caller's first SpeakCall lesson after the Pirsumfon welcome. Say warmly and briefly in Hebrew: \"שלום, כאן ספיקול!\" Introduce yourself by name and ask for their first name only if unknown. Do not mention a duration, menu or registration in the opening.";
    }
    return "The caller just pressed 1 at the end of a SpeakCall ad. Say warmly and briefly in Hebrew: \"שלום, כאן ספיקול!\" Introduce yourself by name and ask for their first name only if unknown. Do not mention a duration, menu or registration in the opening.";
  }
  return "This returning learner pressed 1 at the end of a SpeakCall ad. Welcome them back briefly in Hebrew by name if known (\"איזה כיף להיפגש שוב\"), without the new-caller introduction or intake, and continue from their last lesson with one short question.";
}

export const PHONE_TUTOR_PITCH = 'Out of character only, when asked about SpeakCall or at an appropriate natural closing: at most one warm Hebrew line, then move on. Example: "כאן אפשר פשוט לדבר ולהתאמן בלי לחץ. יש לנו סבלנות, גם כשצריך לנסות שוב." Do not interrupt practice, repeat a pitch, or imply unlimited access.';
export const PHONE_NUMBER_GUIDANCE = `If asked how to call SpeakCall again, the only allowed number is ${SPEAKCALL_PHONE}. Never repeat or offer a different phone number.`;

export const SUMMARY_CALLBACK_TOOL = {
  name: "request_summary_callback",
  description: "Request one voice recap after hangup, only when the caller clearly accepts your offer or directly requests a summary call in this turn.",
  parameters: { type: "object", properties: {} },
};

export const SUMMARY_CALLBACK_GUIDANCE = 'At a natural close after practice or when asked, offer one optional short voice recap after hangup. Ask naturally, e.g. "שיחת סיכום תעזור? לשלוח?" and let the caller answer in their own words. Call request_summary_callback only after a clear yes to this offer or a direct request for a summary call, in Hebrew or English. No, silence, and ambiguous or unrelated answers are not consent. If unsure, clarify once without telling the caller what to say. Only if it returns saved=true say "סגור, רשמתי שיחת סיכום קצרה." Do not promise delivery. Do not confuse it with tomorrow\'s lesson. Never ask for a phone number.';

export function revokesSummaryCall(speech: string) {
  return /(?:אל תתקשר|אל תשלח|לא רוצה (?:שיחת )?סיכום|בלי (?:שיחת )?סיכום|בטל את שיחת הסיכום|\b(?:no summary(?: call)?|cancel (?:the )?summary call|don['’]t (?:call (?:me )?back|send (?:me )?(?:a |the )?summary))\b)/i.test(speech);
}

export function hasEligibleSummaryCallResponse(speech: string) {
  const response = speech.normalize("NFKC").replace(/[.!?,;:"“”״]/g, " ").replace(/\s+/g, " ").trim();
  return /\p{L}/u.test(response) && !/^(?:לא(?: תודה)?|no(?: thanks| thank you)?|nope)$/i.test(response) && !revokesSummaryCall(response);
}

export function adRuntimeContext(context: Record<string, any>): string {
  if (context.entry !== "ad") return "";
  const plans = (Object.entries(SALES_PLANS) as [PlanId, { name: string; price: string }][]).map(([id, p]) => `${p.name} (${id}): ${p.price}`).join("; ");
  return [
    "Ad caller flow (authoritative for this call; it replaces the longer first-call intake):",
    context.ad_new_caller
      ? '- Intake: one question at a time in Hebrew: first name if unknown, then level (רמת בסיס, ביניים או רמה מתקדמת). Ask nothing else before practice; no story request, length, topic, style or teacher gender. On learning level, call save_intake (goal other unless mentioned; learner_name only if given) and immediately start the first-minute practice below. Whenever asked for Hebrew, explain/translate and continue in Hebrew.'
      : "- Returning caller: skip the introductory questionnaire. Continue the lesson; if no level was saved, calibrate briefly in conversation and save the goal and level once known.",
    "- First minute: frame practice in Hebrew, at the stated level and goal. Beginners practise a useful short English sentence; intermediate/advanced learners get a natural, open-ended question to answer in their own English, not a repeat-after-me drill.",
    "- Call start_ad_practice once after the first actual English-practice response, never for greeting, level assessment or intake.",
    '- At a natural pause, describe the method briefly: "בספיקול לומדים לדבר דרך שיחה. השיטה מזהה מה כדאי לחזק ומתאימה את האימון לנושאים שחשוב לתרגל." Keep it to that one line and return to practice immediately. Do not make proficiency guarantees.',
    '- Only after the application signals 90 seconds of practice and the learner shows interest, ask "באיזו שעה נוח להמשיך מחר?" Call schedule_next_lesson only with explicit agreement and a time/part of day. Only on saved=true, confirm the time and invite registration at speakool.net to practise with saved progress. Never request registration email or claim to register them here.',
    "- Closing: give a short Hebrew recap with one actual result from this call. Do not inflate counts, interrupt practice or hold someone on the line to sell.",
    "- Do not offer to email the lesson summary or collect an email address unprompted. Only on explicit email-delivery request, accept letters/digits, preserving all digits and leading zeros; clarify only ambiguous characters. Call prepare_email with the full address, then say only \"הכתובת היא [address]. הכתובת נכונה?\", digits/symbols in English (zero, one, at, dot). Await explicit yes; corrections require preparing/reading back again. Failed confirmation: retry read-back once or say email was not sent. On accepted read-back, call save_email with the identical address, practised English words and one Hebrew summary sentence before continuing. Only its saved=true permits claiming saved/sent; prepare_email does neither.",
    PHONE_TUTOR_PITCH,
    `- If asked about pricing, answer briefly and recommend at most one relevant plan with its price and one reason to subscribe: ${plans}. All plans are at speakool.net. Do not announce a session length or assume free minutes remain.`,
    "- At the end, you may recommend one plan (price and one reason). Only if the learner asks for a payment link by email or SMS, call request_payment_link for that channel. Never claim an SMS was already sent.",
    "- Never offer a discounted first month, a 29 shekel price, a free trial that requires a credit card, or any price or benefit not listed here. Do not pressure; one offer is enough.",
    "- Say goodbye once and call end_session.",
  ].join("\n");
}

export const SCHEDULE_LESSON_TOOL = {
  name: "schedule_next_lesson",
  description: "Save when the learner wants their next lesson (the learner's own answer, e.g. tomorrow morning).",
  parameters: {
    type: "object",
    properties: {
      day: { type: "string", enum: ["today", "tomorrow", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "this_week", "other"] },
      part_of_day: { type: "string", enum: ["morning", "noon", "afternoon", "evening"] },
      time: { type: "string", description: "Exact Israeli local time for tomorrow in 24-hour HH:mm, only if the learner stated it. Omit for an approximate part of day." },
      note: { type: "string", description: "The learner's words in Hebrew, short" },
    },
    required: ["day", "part_of_day"],
  },
};
const emailParameter = { type: "string", description: "Exact address using digits 0-9 as spoken, including any leading zeros. Example: a012345@example.com." };
export const PREPARE_EMAIL_TOOL = {
  name: "prepare_email",
  description: "Stage the learner's complete address before reading it back, without saving or sending anything. Ask for an explicit yes and wait for their answer.",
  parameters: { type: "object", properties: { email: emailParameter }, required: ["email"] },
};
export const SAVE_EMAIL_TOOL = {
  name: "save_email",
  description: "Send the practice summary only after the learner explicitly confirms the exact address from prepare_email in a separate turn after you read it back.",
  parameters: {
    type: "object",
    properties: {
      email: emailParameter,
      words: { type: "array", items: { type: "string" }, description: "English words or short phrases practised in this call, up to 12" },
      summary: { type: "string", description: "One short Hebrew sentence on what the learner achieved today" },
    },
    required: ["email"],
  },
};
export const PAYMENT_LINK_TOOL = {
  name: "request_payment_link",
  description: "The learner asked to receive a payment link for one plan. By email it is sent immediately to the saved email; by SMS the SpeakCall team sends it.",
  parameters: {
    type: "object",
    properties: {
      plan_id: { type: "string", enum: PLAN_IDS },
      channel: { type: "string", enum: ["sms", "email"] },
    },
    required: ["plan_id", "channel"],
  },
};
const salesActions = [SCHEDULE_LESSON_TOOL, PREPARE_EMAIL_TOOL, SAVE_EMAIL_TOOL, PAYMENT_LINK_TOOL];
export const SALES_TOOL_NAMES = new Set(salesActions.map((t) => t.name));
export const SALES_TOOLS = [...salesActions, {
  name: "start_ad_practice",
  description: "Start the practice timer only after the learner first responds in English practice, not during intake.",
  parameters: { type: "object", properties: {} },
}];

const scheduleArgs = z.object({ day: z.string().max(40).default("other"), part_of_day: z.enum(["morning", "noon", "afternoon", "evening"]), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(), note: z.string().max(200).optional() });
const emailAddress = z.string().trim().toLowerCase().max(120).email();
const emailArgs = z.object({ email: emailAddress, words: z.array(z.string().trim().min(1).max(60)).max(12).optional(), summary: z.string().trim().max(300).optional() });
const linkArgs = z.object({ plan_id: z.enum(PLAN_IDS), channel: z.enum(["sms", "email"]) });

export function normalizeSalesEmail(value: unknown) {
  const parsed = emailAddress.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const spokenEmail: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  at: "@", dot: ".", dash: "-", hyphen: "-", underscore: "_", plus: "+",
};

export function matchesEmailReadBack(text: string, email: string) {
  const readBack = text.normalize("NFKC").toLowerCase().trim()
    .match(/^הכתובת היא\s*:?\s*(.+?)[.!?,]?\s+הכתובת נכונה[?.]?$/s);
  if (!readBack) return false;
  let offsets = new Set([0]);
  for (const word of readBack[1]!.trim().split(/\s+/)) {
    const alias = Object.hasOwn(spokenEmail, word) ? spokenEmail[word] : undefined;
    const next = new Set<number>();
    for (const offset of offsets) {
      if (email.startsWith(word, offset)) next.add(offset + word.length);
      if (alias && email.startsWith(alias, offset)) next.add(offset + alias.length);
    }
    if (!next.size) return false;
    offsets = next;
  }
  return offsets.has(email.length);
}

export function isEmailConfirmation(value: string) {
  const answer = value.normalize("NFKC").toLowerCase().replace(/[’׳]/g, "'").replace(/[,.!?;:]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:yes(?: (?:please|it is|that's (?:correct|right)|that is correct|(?:that|the) address is correct))?|correct|that's (?:correct|right)|that is correct|כן(?: (?:נכון|בדיוק|זה נכון|זו הכתובת|זאת הכתובת|הכתובת נכונה|תודה))?|נכון|זה נכון|בדיוק|אכן)$/.test(answer);
}

export function paymentLink(planId: PlanId, campaign: string) {
  return `${SALES_SITE}/learn?plan=${encodeURIComponent(planId)}&src=${encodeURIComponent("ad-" + campaign)}`;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function sendMail(mail: SendEmail | undefined, to: string, subject: string, lines: string[], html = `<div dir="rtl" lang="he">${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>`): Promise<boolean> {
  if (!mail) return false;
  try {
    await mail.send({ from: SALES_SENDER, to, subject, text: lines.join("\n"), html });
    return true;
  } catch {
    return false;
  }
}

export function wordsEmail(words: string[] = [], summary = "", teacher = DEFAULT_TEACHER_NAME, learner = "", female = false) {
  const greeting = `שלום${learner ? " " + learner : ""}, ${female ? "זו" : "זה"} ${teacher} מצוות ההוראה של ספיקול.`;
  const text = [
    greeting,
    ...(summary ? [summary] : []),
    ...(words.length ? ["המילים מהתרגול היום:", ...words.map((w) => "• " + w)] : []),
    "להמשך תרגול: " + SALES_SITE,
  ];
  const html = `<div dir="rtl" lang="he" style="font:16px Arial,sans-serif;color:#172334;line-height:1.6;background:#f3f6fa;padding:20px">
    <div style="max-width:540px;margin:auto;background:#fff;border:1px solid #dce4ee;border-radius:12px;padding:24px">
    <p style="color:#174d77;font-weight:bold;margin-top:0">ספיקול · סיכום שיעור</p>
    <h1 style="font-size:21px">${escapeHtml(greeting)}</h1>
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
    ${words.length ? `<h2 style="font-size:17px">המילים מהתרגול היום</h2><ul>${words.map(word => `<li><span dir="ltr">${escapeHtml(word)}</span></li>`).join("")}</ul>` : ""}
    <p><a href="${SALES_SITE}" style="color:#174d77">להמשך תרגול בספיקול</a></p></div></div>`;
  return { text, html };
}

export type SalesToolResult = boolean | {
  saved: false;
  reason: "outside_hours" | "outside_calling_window";
  allowed_hours: string;
  time_zone: string;
  closed_period: string;
  next_step: "explain_hours_and_offer_another_time";
};

export async function recordSalesTool(b: BusinessStore, customerId: string, callId: string, name: string, args: unknown, mail?: SendEmail, callerPhone = "", teacher?: { name?: string; female?: boolean }): Promise<SalesToolResult> {
  if (customerId.startsWith("anonymous-")) return false;
  const context = await b.loadContext(callId);
  const campaign = campaignName(context.campaign);
  const base = { customer_id: customerId, call_id: callId, campaign, status: "pending", at: nowIso() };
  if (name === "schedule_next_lesson") {
    const parsed = scheduleArgs.safeParse(args);
    if (!parsed.success) return false;
    const id = (await sha256Hex("lesson:" + customerId + ":" + callId)).slice(0, 32);
    const existing = await b.record(SALES_FOLLOWUPS, id);
    const unchanged = existing && existing.day === parsed.data.day && existing.part_of_day === parsed.data.part_of_day && existing.time === parsed.data.time;
    const at = unchanged && existing.scheduled_at ? new Date(existing.scheduled_at)
      : parsed.data.time ? (parsed.data.day === "tomorrow" ? tomorrowAt(parsed.data.time, new Date(base.at)) : null)
        : followupLessonTime(parsed.data.day, parsed.data.part_of_day, new Date(base.at));
    if (!at) {
      if (!parsed.data.time || parsed.data.day !== "tomorrow") return false;
      const hour = Number(parsed.data.time.slice(0, 2));
      return {
        saved: false,
        reason: hour >= 8 && hour < 22 ? "outside_calling_window" : "outside_hours",
        allowed_hours: "08:00–22:00",
        time_zone: "Asia/Jerusalem",
        closed_period: "Friday 14:00–Saturday 20:00",
        next_step: "explain_hours_and_offer_another_time",
      };
    }
    if (!await enqueueLessonCallback(b, customerId, id, at, existing?.at ?? base.at, callerPhone)) return false;
    await b.savePreference(customerId, { next_lesson: { ...parsed.data, requested_at: base.at, scheduled_at: at.toISOString(), callback_id: id } });
    await b.save(SALES_FOLLOWUPS, { ...base, at: existing?.at ?? base.at, type: "lesson", ...parsed.data, scheduled_at: at.toISOString(), callback_id: id }, id);
    return true;
  }
  if (name === "save_email") {
    const parsed = emailArgs.safeParse(args);
    if (!parsed.success) return false;
    const { email, words, summary } = parsed.data;
    const preferences = await b.loadContext("preferences:" + customerId);
    const customerName = String((await b.record("customers", customerId))?.name ?? "").trim();
    const learnerName = String(preferences.learner_name || (customerName === PHONE_SIGNUP_NAME ? "" : customerName)).trim().slice(0, 40);
    await b.savePreference(customerId, { email });
    const message = wordsEmail(words, summary, teacher?.name, learnerName, teacher?.female);
    const sent = await sendMail(mail, email, "סיכום השיעור בספיקול", message.text, message.html);
    await b.save(SALES_FOLLOWUPS, { ...base, type: "email", email, words: words ?? [], summary: summary ?? "", status: sent ? "sent" : "pending" });
    return sent;
  }
  if (name === "request_payment_link") {
    const parsed = linkArgs.safeParse(args);
    if (!parsed.success) return false;
    const email = (await b.loadContext("preferences:" + customerId)).email;
    if (parsed.data.channel === "email" && !email) return false;
    const link = paymentLink(parsed.data.plan_id, campaign);
    const plan = SALES_PLANS[parsed.data.plan_id];
    const sent = parsed.data.channel === "email" && await sendMail(mail, email, `קישור להצטרפות למסלול ${plan.name} בספיקול`, ["שלום מספיקול,", `זה הקישור שביקשו מאיתנו לשלוח להצטרפות למסלול ${plan.name} (${plan.price}):`, link, "אם יש שאלה, אפשר פשוט לענות למייל או להתקשר."]);
    await b.save(SALES_FOLLOWUPS, { ...base, type: "payment_link", ...parsed.data, ...(parsed.data.channel === "email" ? { email } : {}), link, status: sent ? "sent" : "pending" });
    return true;
  }
  return false;
}

export async function adCampaignReport(env: Env) {
  const b = new BusinessStore(env.DB);
  const excluded = await qaCustomerIds(env.DB);
  const entries = (await b.list(AD_ENTRIES)).filter(e => !excluded.has(e.customer_id));
  const followups = (await b.list(SALES_FOLLOWUPS)).filter(f => !excluded.has(f.customer_id));
  const rows: Record<string, { campaign: string; calls: number; new_callers: number; returning_callers: number; lessons_booked: number; emails: number; payment_links: number }> = {};
  const row = (campaign: string) => (rows[campaign] ??= { campaign, calls: 0, new_callers: 0, returning_callers: 0, lessons_booked: 0, emails: 0, payment_links: 0 });
  for (const e of entries) {
    const r = row(campaignName(e.campaign));
    r.calls++;
    if (e.new_caller) r.new_callers++; else r.returning_callers++;
  }
  for (const f of followups) {
    const r = row(campaignName(f.campaign));
    if (f.type === "lesson") r.lessons_booked++;
    if (f.type === "email") r.emails++;
    if (f.type === "payment_link") r.payment_links++;
  }
  return {
    campaigns: Object.values(rows).sort((a, b) => b.calls - a.calls),
    followups: await Promise.all(followups.filter((f) => f.status === "pending").map(async (f): Promise<Record<string, any>> => ({ ...f, phone: (await b.record("customers", f.customer_id))?.phone ?? "" }))),
  };
}
