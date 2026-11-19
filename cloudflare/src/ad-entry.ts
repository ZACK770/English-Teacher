import { z } from "zod";
import { BusinessStore } from "./business";
import { type Env, nowIso, randomHex, sha256Hex, type Settings } from "./env";
import { enqueueLessonCallback, followupLessonTime } from "./callbacks";
import { ProgressStore } from "./progress";
import { startSchool, type IVRResponse } from "./pbx";

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
    const newCaller = !saved.plan && !saved.intro_school_seen;
    await b.saveContext(callId, { entry: "ad", campaign: name, ad_new_caller: newCaller });
    if (!saved.ad_campaign) await b.savePreference(customerId, { ad_campaign: name });
    await b.save(AD_ENTRIES, { call_id: callId, customer_id: customerId, campaign: name, new_caller: newCaller, at: nowIso() }, randomHex(16));
  }
  return startSchool(b, progress, s, callId, customerId);
}

export function adOpening(context: Record<string, any>): string | null {
  if (context.entry !== "ad") return null;
  if (context.ad_new_caller) {
    return "The caller just pressed 1 at the end of a SpeakCall radio/phone ad offering a free lesson. Say exactly, warmly and briefly in Hebrew: \"היי, הגעת לספיקול. המורה מחכה לך, ועשר הדקות הראשונות עלינו.\" Then introduce yourself by name in one short sentence and ask only for the learner's first name. No menu, no registration, no speech.";
  }
  return "This returning learner pressed 1 at the end of a SpeakCall ad. Welcome them back briefly in Hebrew by name if known (\"טוב לשמוע אותך שוב\"), without the new-caller introduction or intake, and continue from their last lesson with one short question.";
}

export const PHONE_TUTOR_PITCH = 'Out of character only, when asked about SpeakCall or at a natural closing if appropriate: say at most one short line in warm Hebrew, then move on. Examples: "כאן אפשר פשוט לדבר ולהתאמן בקצב שלך. יש לנו סבלנות, גם כשצריך לנסות שוב." / "לא צריך לחכות עד שהאנגלית תהיה מושלמת. פשוט מתחילים לדבר. רוצה לנסות?" / "אפשר להמשיך לתרגל בכל פעם שנוח לך, לפי הדקות שבמסלול שלך." Do not interrupt practice, repeat a pitch, or imply unlimited free minutes.';

export function adRuntimeContext(context: Record<string, any>): string {
  if (context.entry !== "ad") return "";
  const plans = (Object.entries(SALES_PLANS) as [PlanId, { name: string; price: string }][]).map(([id, p]) => `${p.name} (${id}): ${p.price}`).join("; ");
  return [
    "Ad caller flow (authoritative for this call; it replaces the longer first-call intake):",
    context.ad_new_caller
      ? "- Intake: ask one question at a time, only: first name, goal (why English: work, travel, study or other), level. Call save_intake as soon as you know goal and level. Skip lesson length, topic, style and teacher gender."
      : "- Returning caller: skip the introductory questionnaire. Continue the lesson; if no level was saved, calibrate briefly in conversation and save the goal and level once known.",
    "- First minute: start at the learner's stated level, on a topic that fits their goal. For a beginner, a short sentence to practise is fine. For an intermediate or advanced learner, start with an open-ended question in natural English, not a repeat-after-me drill.",
    "- Closing (when the closing stage is reached or the learner wants to stop): a Hebrew summary with a concrete reward counted from this call only, e.g. \"היום אמרת 9 משפטים, ו־5 מילים חדשות כבר שלך\" (never inflate the numbers). Then book the next lesson: ask \"מחר בבוקר או בערב?\" and call schedule_next_lesson with the answer. Then offer to email today's words.",
    "- Email (also if the learner asks earlier): accept letters and digits alike. Preserve all digits and leading zeros. If any characters are unclear, ask only about those characters; never fill them in yourself. Call prepare_email with the complete address, then say only \"הכתובת היא [address]. הכתובת נכונה?\". Say each digit and symbol in English (zero, one, at, dot, etc.). Wait for an explicit yes before calling save_email with the identical address. If corrected, prepare and read back the corrected address. If confirmation fails, try the read-back once more or say the email was not sent.",
    PHONE_TUTOR_PITCH,
    `- Plans you may describe when relevant or asked (approved prices, nothing else): ${plans}. After the 10-minute free opening lesson every learner keeps two free 5-minute calls per month. All plans are on the website speakool.net.`,
    "- For an accepted read-back, you MUST call save_email with the English words practised in this call and a one-sentence Hebrew summary before continuing the conversation. Say the address was saved or the email sent only if save_email returns saved=true; prepare_email never saves or sends anything.",
    "- At the end, recommend one plan that fits what you heard (price and one reason). If the learner wants it, offer the payment link by email (sent right away) or by SMS (the SpeakCall team sends it soon) and call request_payment_link. Never claim an SMS was already sent.",
    "- Never offer a discounted first month, a 29 shekel price, a free trial that requires a credit card, or any price or benefit not listed here. Do not pressure; one offer is enough.",
    "- Close by reminding them of the two free 5-minute calls each month and that the plans are on speakool.net, then say goodbye and call end_session.",
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
export const SALES_TOOLS = [SCHEDULE_LESSON_TOOL, PREPARE_EMAIL_TOOL, SAVE_EMAIL_TOOL, PAYMENT_LINK_TOOL];
export const SALES_TOOL_NAMES = new Set(SALES_TOOLS.map((t) => t.name));

const scheduleArgs = z.object({ day: z.string().max(40).default("other"), part_of_day: z.enum(["morning", "noon", "afternoon", "evening"]), note: z.string().max(200).optional() });
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
  const address = readBack[1]!;
  return address.replace(/\s+/g, "") === email
    || address.replace(/(?<![a-z0-9_@.+-])[a-z]+(?![a-z0-9_@.+-])/g, word => spokenEmail[word] ?? word).replace(/\s+/g, "") === email;
}

export function isEmailConfirmation(value: string) {
  const answer = value.normalize("NFKC").toLowerCase().replace(/[’׳]/g, "'").replace(/[,.!?;:]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:yes(?: (?:please|it is|that's (?:correct|right)|that is correct|(?:that|the) address is correct))?|correct|that's (?:correct|right)|that is correct|כן(?: (?:נכון|בדיוק|זה נכון|זו הכתובת|זאת הכתובת|הכתובת נכונה|תודה))?|נכון|זה נכון|בדיוק|אכן)$/.test(answer);
}

export function paymentLink(planId: PlanId, campaign: string) {
  return `${SALES_SITE}/learn?plan=${encodeURIComponent(planId)}&src=${encodeURIComponent("ad-" + campaign)}`;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function sendMail(mail: SendEmail | undefined, to: string, subject: string, lines: string[]): Promise<boolean> {
  if (!mail) return false;
  try {
    await mail.send({ from: SALES_SENDER, to, subject, text: lines.join("\n"), html: `<div dir="rtl" lang="he">${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>` });
    return true;
  } catch {
    return false;
  }
}

export function wordsEmail(words: string[] = [], summary = ""): string[] {
  return [
    "שלום מספיקול,",
    ...(summary ? [summary] : []),
    ...(words.length ? ["המילים שתרגלת היום:", ...words.map((w) => "• " + w)] : []),
    "בכל חודש יש לך שתי שיחות חינמיות של 5 דקות. המסלולים באתר: " + SALES_SITE,
  ];
}

export async function recordSalesTool(b: BusinessStore, customerId: string, callId: string, name: string, args: unknown, mail?: SendEmail, callerPhone = ""): Promise<boolean> {
  if (customerId.startsWith("anonymous-")) return false;
  const context = await b.loadContext(callId);
  const campaign = campaignName(context.campaign);
  const base = { customer_id: customerId, call_id: callId, campaign, status: "pending", at: nowIso() };
  if (name === "schedule_next_lesson") {
    const parsed = scheduleArgs.safeParse(args);
    if (!parsed.success) return false;
    const id = (await sha256Hex("lesson:" + customerId + ":" + callId)).slice(0, 32);
    const existing = await b.record(SALES_FOLLOWUPS, id);
    const unchanged = existing && existing.day === parsed.data.day && existing.part_of_day === parsed.data.part_of_day;
    const at = unchanged && existing.scheduled_at ? new Date(existing.scheduled_at) : followupLessonTime(parsed.data.day, parsed.data.part_of_day, new Date(base.at));
    if (!await enqueueLessonCallback(b, customerId, id, at, existing?.at ?? base.at, callerPhone)) return false;
    await b.savePreference(customerId, { next_lesson: { ...parsed.data, requested_at: base.at, scheduled_at: at.toISOString(), callback_id: id } });
    await b.save(SALES_FOLLOWUPS, { ...base, at: existing?.at ?? base.at, type: "lesson", ...parsed.data, scheduled_at: at.toISOString(), callback_id: id }, id);
    return true;
  }
  if (name === "save_email") {
    const parsed = emailArgs.safeParse(args);
    if (!parsed.success) return false;
    const { email, words, summary } = parsed.data;
    await b.savePreference(customerId, { email });
    const sent = await sendMail(mail, email, "המילים שלך מהשיעור בספיקול", wordsEmail(words, summary));
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
    const sent = parsed.data.channel === "email" && await sendMail(mail, email, `קישור להצטרפות למסלול ${plan.name} בספיקול`, ["שלום מספיקול,", `לבקשתך, זה הקישור להצטרפות למסלול ${plan.name} (${plan.price}):`, link, "אם יש שאלה, אפשר פשוט לענות למייל או להתקשר."]);
    await b.save(SALES_FOLLOWUPS, { ...base, type: "payment_link", ...parsed.data, ...(parsed.data.channel === "email" ? { email } : {}), link, status: sent ? "sent" : "pending" });
    return true;
  }
  return false;
}

export async function adCampaignReport(env: Env) {
  const b = new BusinessStore(env.DB);
  const entries = await b.list(AD_ENTRIES);
  const followups = await b.list(SALES_FOLLOWUPS);
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
