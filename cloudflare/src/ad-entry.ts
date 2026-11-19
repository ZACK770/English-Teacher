import { z } from "zod";
import { BusinessStore } from "./business";
import { type Env, nowIso, randomHex, type Settings } from "./env";
import { ProgressStore } from "./progress";
import { startSchool, type IVRResponse } from "./pbx";

export const AD_ENTRIES = "ad-entries";
export const SALES_FOLLOWUPS = "sales-followups";
export const DEFAULT_CAMPAIGN = "general";
export const SALES_SITE = "https://speakcall.app";

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
    const newCaller = !saved.plan && !saved.intro_school_seen && !saved.ad_campaign;
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

export function adRuntimeContext(context: Record<string, any>): string {
  if (context.entry !== "ad") return "";
  const plans = (Object.entries(SALES_PLANS) as [PlanId, { name: string; price: string }][]).map(([id, p]) => `${p.name} (${id}): ${p.price}`).join("; ");
  return [
    "Ad caller flow (authoritative for this call; it replaces the longer first-call intake):",
    context.ad_new_caller
      ? "- Intake: ask one question at a time, only: first name, goal (why English: work, travel, study or other), level. Call save_intake as soon as you know goal and level. Skip lesson length, topic, style and teacher gender."
      : "- Returning caller: no intake; continue the learner's lesson.",
    "- First minute: give the learner one short English sentence that fits their goal, ask them to say it, and praise the attempt specifically in Hebrew.",
    "- Closing (when the closing stage is reached or the learner wants to stop): a Hebrew summary with a concrete reward counted from this call only, e.g. \"היום אמרת 9 משפטים, ו־5 מילים חדשות כבר שלך\" (never inflate the numbers). Then book the next lesson: ask \"מחר בבוקר או בערב?\" and call schedule_next_lesson with the answer. Then ask for an email to send today's words; ask the learner to spell it, read it back once, and call save_email only after they confirm.",
    `- Plans you may describe when relevant or asked (approved prices, nothing else): ${plans}. After the 10-minute free opening lesson every learner keeps two free 5-minute calls per month. All plans are on the website speakcall.app.`,
    "- At the end, recommend one plan that fits what you heard (price and one reason). If the learner wants it, ask whether to get the payment link by SMS or email and call request_payment_link. Say the SpeakCall team will send the link; do not promise a specific minute.",
    "- Never offer a discounted first month, a 29 shekel price, a free trial that requires a credit card, or any price or benefit not listed here. Do not pressure; one offer is enough.",
    "- Close by reminding them of the two free 5-minute calls each month and that the plans are on speakcall.app, then say goodbye and call end_session.",
  ].join("\n");
}

export const SCHEDULE_LESSON_TOOL = {
  name: "schedule_next_lesson",
  description: "Save when the learner wants their next lesson (the learner's own answer, e.g. tomorrow morning).",
  parameters: {
    type: "object",
    properties: {
      day: { type: "string", enum: ["today", "tomorrow", "this_week", "other"] },
      part_of_day: { type: "string", enum: ["morning", "afternoon", "evening"] },
      note: { type: "string", description: "The learner's words in Hebrew, short" },
    },
    required: ["day", "part_of_day"],
  },
};
export const SAVE_EMAIL_TOOL = {
  name: "save_email",
  description: "Save the learner's email address after they spelled it and confirmed it, to send today's words.",
  parameters: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
};
export const PAYMENT_LINK_TOOL = {
  name: "request_payment_link",
  description: "The learner asked to receive a payment link for one plan. The SpeakCall team sends it.",
  parameters: {
    type: "object",
    properties: {
      plan_id: { type: "string", enum: PLAN_IDS },
      channel: { type: "string", enum: ["sms", "email"] },
    },
    required: ["plan_id", "channel"],
  },
};
export const SALES_TOOLS = [SCHEDULE_LESSON_TOOL, SAVE_EMAIL_TOOL, PAYMENT_LINK_TOOL];
export const SALES_TOOL_NAMES = new Set(SALES_TOOLS.map((t) => t.name));

const scheduleArgs = z.object({ day: z.enum(["today", "tomorrow", "this_week", "other"]), part_of_day: z.enum(["morning", "afternoon", "evening"]), note: z.string().max(200).optional() });
const emailArgs = z.object({ email: z.string().trim().toLowerCase().max(120).email() });
const linkArgs = z.object({ plan_id: z.enum(PLAN_IDS), channel: z.enum(["sms", "email"]) });

export function paymentLink(planId: PlanId, campaign: string) {
  return `${SALES_SITE}/join?plan=${encodeURIComponent(planId)}&src=${encodeURIComponent("ad-" + campaign)}`;
}

export async function recordSalesTool(b: BusinessStore, customerId: string, callId: string, name: string, args: unknown): Promise<boolean> {
  if (customerId.startsWith("anonymous-")) return false;
  const context = await b.loadContext(callId);
  const campaign = campaignName(context.campaign);
  const base = { customer_id: customerId, call_id: callId, campaign, status: "pending", at: nowIso() };
  if (name === "schedule_next_lesson") {
    const parsed = scheduleArgs.safeParse(args);
    if (!parsed.success) return false;
    await b.savePreference(customerId, { next_lesson: { ...parsed.data, requested_at: base.at } });
    await b.save(SALES_FOLLOWUPS, { ...base, type: "lesson", ...parsed.data });
    return true;
  }
  if (name === "save_email") {
    const parsed = emailArgs.safeParse(args);
    if (!parsed.success) return false;
    await b.savePreference(customerId, { email: parsed.data.email });
    await b.save(SALES_FOLLOWUPS, { ...base, type: "email", email: parsed.data.email });
    return true;
  }
  if (name === "request_payment_link") {
    const parsed = linkArgs.safeParse(args);
    if (!parsed.success) return false;
    const email = (await b.loadContext("preferences:" + customerId)).email;
    if (parsed.data.channel === "email" && !email) return false;
    await b.save(SALES_FOLLOWUPS, { ...base, type: "payment_link", ...parsed.data, ...(parsed.data.channel === "email" ? { email } : {}), link: paymentLink(parsed.data.plan_id, campaign) });
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
    followups: followups.filter((f) => f.status === "pending").slice(0, 100),
  };
}
