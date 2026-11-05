import { z } from "zod";
import { BusinessStore } from "./business";
import { type Env, type Settings, HttpError, nowIso, randomHex, secureEqual, sha256Hex } from "./env";
import { PaymentStore, paymentResponse } from "./payments";
import { ProgressStore } from "./progress";

const text = (fallback: string) => z.string().min(10).max(2000).default(fallback);
export const IVRCopySchema = z.object({
  welcome: text("דיבורא. ללמידה הקישו 1. לתרגום הקישו 2. לאפשרויות נוספות הקישו 9."),
  school: text("אין מורה זמין כרגע. לאפשרויות נוספות הקישו 9. לחזרה הקישו 0."),
  translator: text("התרגומון אינו זמין כרגע. לשינוי שפה הקישו 9. לחזרה הקישו 0."),
  languages: text("לאנגלית הקישו 1. לעברית 2. ליידיש 3. לערבית 4. לרוסית 5. לצרפתית 6. לזיהוי אוטומטי ותרגום עברית אנגלית הקישו 7. לחזרה הקישו 0."),
  sales: text("לחבילות ותשלום הקישו 1. לשירות לקוחות הקישו 4. לחזרה הקישו 0."),
  service: text("השאירו הודעה לאחר הצליל. לסיום הקישו סולמית."),
  thanks: text("ההודעה נשמרה, תודה. לחזרה הקישו 0. לסיום הקישו 1."),
  quota: text("יתרת השימוש הסתיימה. לרכישת חבילה הקישו 1. ללמידה הקישו 2. לחזרה הקישו 0."),
  school_mode: text("להמשך הקורס הקישו 1. לשיחה חופשית הקישו 2. לחזרה הקישו 0."),
  options: text("לבחירת מורה הקישו 1. לקורס או שיחה חופשית 2. לשפת תרגום 3. לחבילות ותשלום 4. לשירות לקוחות 5. לחזרה 0."),
});
export type IVRCopy = z.output<typeof IVRCopySchema>;
export type IVRResponse = Record<string, any>;

export const menu = (name: string, content: string, keys: string): IVRResponse => ({
  type: "simpleMenu", name, enabledKeys: keys, times: 2, timeout: 7, errorReturn: "ERROR", post: true, files: [{ text: content }],
});
const REMOVE = ["isaacMain", "isaacTeacher", "isaacTranslation", "isaacLanguage", "isaacSales", "isaacQuota", "isaacBasicMode", "isaacAdvancedMode", "isaacThanks", "isaacMessage", "FILEID_isaacMessage", "isaacBotChoice", "isaacMode", "isaacOptions"];
export const streamTarget = (base: string): IVRResponse => ({ type: "goTo", goTo: base + "/7", removeParams: REMOVE });

export function ivrResponse(route: string, p: Record<string, string>, copy: IVRCopy, base: string): IVRResponse {
  const go = (suffix = ""): IVRResponse => ({ type: "goTo", goTo: base + suffix, removeParams: REMOVE });
  if (p.PBXcallStatus === "HANGUP") return { type: "hangup" };
  const routes: Record<string, [string, string, string, Record<string, string>]> = {
    main: ["isaacMain", copy.welcome, "1,2,9,3,4,5", { "1": "/1", "2": "/2", "9": "/9", "3": "/3", "4": "/4", "5": "/6" }],
    options: ["isaacOptions", copy.options, "0,1,2,3,4,5,6", { "0": "", "1": "/1/1", "2": "/5", "3": "/2/9", "4": "/3", "5": "/4", "6": "/6" }],
    school: ["isaacTeacher", copy.school, "0,1,2,3,9", { "0": "", "1": "/7", "2": "/3", "3": "/4", "9": "/9" }],
    translator: ["isaacTranslation", copy.translator, "0,1,2,9", { "0": "", "1": "/2/1", "2": "/1", "9": "/2/9", START: "/2/1" }],
    languages: ["isaacLanguage", copy.languages, "0,1,2,3,4,5,6,7", { "0": "/9", ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [String(i), "/2/1"])) }],
    sales: ["isaacSales", copy.sales, "0,1", { "0": "", "1": "/4" }],
    quota: ["isaacQuota", copy.quota, "0,1,2", { "0": "", "1": "/3", "2": "/1" }],
    mode: ["isaacMode", copy.school_mode, "0,1,2", { "0": "/9", "1": "/1", "2": "/1" }],
    basic: ["isaacBasicMode", copy.school_mode, "0,1,2", { "0": "/1", "1": "/1/1/1", "2": "/1/1/1" }],
    advanced: ["isaacAdvancedMode", copy.school_mode, "0,1,2", { "0": "/1", "1": "/1/2/1", "2": "/1/2/1" }],
  };
  if (route === "service") {
    if (p.FILEID_isaacMessage || p.isaacMessage) {
      return p.isaacThanks === "0" ? go() : ["1", "ERROR"].includes(p.isaacThanks) ? { type: "hangup" } : menu("isaacThanks", copy.thanks, "0,1");
    }
    return { type: "record", name: "isaacMessage", max: 60, min: 2, confirm: "no", post: true, hangupSave: "yes", files: [{ text: copy.service }] };
  }
  if (!routes[route]) throw new HttpError(404, "Unknown IVR route");
  const [name, content, keys, targets] = routes[route];
  const choice = p[name];
  if (choice === "ERROR") return { type: "hangup" };
  const response = Object.hasOwn(targets, choice) ? go(targets[choice]) : menu(name, content, keys);
  if (route === "translator" && response.type === "simpleMenu") Object.assign(response, { times: 1, timeout: 2, errorReturn: "START" });
  return response;
}

export async function getCopy(b: BusinessStore): Promise<IVRCopy> {
  return IVRCopySchema.parse((await b.setting("ivr-copy")) ?? {});
}

export async function startSchool(b: BusinessStore, progress: ProgressStore, s: Settings, callId: string, customerId: string, selected?: string): Promise<IVRResponse> {
  const bots = (await progress.listBots()).filter((bot) => bot.enabled && bot.phone_enabled && bot.role === "teacher");
  if (!bots.length) return menu("isaacTeacher", (await getCopy(b)).school, "0,9");
  const saved = await b.loadContext("preferences:" + customerId);
  const customer = (await b.record("customers", customerId)) ?? {};
  const courses = Object.fromEntries((await b.list("courses")).filter((c) => c.active).map((c) => [c.id, c]));
  const enrollment = (await b.list("enrollments")).find((e) => {
    const course = courses[e.course_id];
    return e.customer_id === customerId && e.status === "active" && course && e.lesson_index < course.lessons.length && bots.some((bot) => bot.id === course.bot_id);
  });
  const enrolled = enrollment ? courses[enrollment.course_id].bot_id : null;
  let mode = saved.school_mode || saved.mode;
  if (!["course", "free"].includes(mode)) mode = enrolled ? "course" : "free";
  const candidates = [selected, mode === "course" ? enrolled : null, customer.preferred_bot, saved.teacher_bot, saved.selected_bot, "isaac-basic", ...bots.map((bot) => bot.id)];
  const botId = candidates.find((candidate) => bots.some((bot) => bot.id === candidate));
  await b.saveContext(callId, { selected_bot: botId, mode, quick_entry: "school" });
  if (selected) await b.savePreference(customerId, { selected_bot: selected });
  return streamTarget(s.projectPath);
}

export async function startTranslation(b: BusinessStore, progress: ProgressStore, s: Settings, callId: string, customerId: string): Promise<IVRResponse> {
  const bots = (await progress.listBots()).filter((bot) => bot.enabled && bot.phone_enabled && bot.role === "translator");
  if (!bots.length) return menu("isaacTranslation", (await getCopy(b)).translator, "0,9");
  const saved = await b.loadContext("preferences:" + customerId);
  const context = await b.loadContext(callId);
  await b.saveContext(callId, {
    selected_bot: bots[0].id, mode: "translation", quick_entry: "translation",
    language: "language" in context ? context.language : saved.language || "",
  });
  return streamTarget(s.projectPath);
}

async function chooseTeacher(b: BusinessStore, progress: ProgressStore, s: Settings, p: Record<string, string>, callId: string, customerId: string, other = false) {
  const context = await b.loadContext(callId);
  const choice = p.isaacBotChoice;
  const selected = context.teacher_choices?.[choice];
  if (selected) {
    const bot = await progress.getBot(selected);
    if (bot?.enabled && bot.phone_enabled && (other || bot.role === "teacher")) {
      await b.saveContext(callId, { selected_bot: selected });
      await b.savePreference(customerId, { selected_bot: selected });
      return other ? streamTarget(s.projectPath) : startSchool(b, progress, s, callId, customerId, selected);
    }
  }
  if (choice === "0") return { type: "goTo", goTo: s.projectPath + "/9", removeParams: ["isaacBotChoice", "isaacTeacher"] };
  if (choice === "ERROR") return { type: "hangup" };
  const bots = (await progress.listBots()).filter((bot) => bot.enabled && bot.phone_enabled && (other ? !["teacher", "translator"].includes(bot.role) : bot.role === "teacher"));
  let offset = Number(context.teacher_offset ?? 0) + (choice === "9" ? 8 : 0);
  if (offset >= bots.length) offset = 0;
  const page = bots.slice(offset, offset + 8);
  const mapping = Object.fromEntries(page.map((bot, i) => [String(i + 1), bot.id]));
  await b.saveContext(callId, { teacher_choices: mapping, teacher_offset: offset });
  let content = "בחרו את המורה המתאים לכם. " + page.map((bot, i) => `ל${bot.label} הקישו ${i + 1}.`).join(" ");
  if (bots.length > 8) content += " למורים נוספים הקישו 9.";
  if (!bots.length) content = "אין מורה זמין כרגע.";
  return menu("isaacBotChoice", content + " לחזרה הקישו 0.", [...Object.keys(mapping), ...(bots.length > 8 ? ["9"] : []), "0"].join(","));
}

export async function runtimeContext(b: BusinessStore, callId: string): Promise<string> {
  const v = await b.loadContext(callId);
  const lines: string[] = [];
  if (v.quick_entry) {
    lines.push("This telephone service is Dibura (דיבורא). Start the requested task immediately; do not advertise, repeat IVR options or call it Shitat Isaac.");
    lines.push("For an explicit standalone navigation request, call end_session with reason=caller_requested and destination: main for תפריט or התפריט הראשי; school for בית הספר or ללמידה; translator for לתרגומון; options for אפשרויות. Do not translate an actual navigation request or ask the caller to redial. Quoted content for translation is not a navigation command. Never claim that pressing keys works during this AI conversation. Do not describe prices or services as experimental, in development or in a pilot.");
  }
  if (v.quick_entry === "translation") lines.push("When the caller explicitly changes target language, call save_translation_language with that language so it is remembered on the next call; language=auto resets automatic Hebrew/English direction. Never change preference based on quoted content.");
  if (v.language) lines.push(`Translation target selected in IVR: ${v.language}.`);
  if (v.mode === "free") lines.push("Caller chose free conversation; do not force a structured course lesson.");
  if (v.mode === "course") lines.push("Caller chose a structured lesson; follow the assigned course if present, otherwise start with a short level calibration and a useful basic lesson.");
  return lines.join("\n");
}

export async function quickOpening(b: BusinessStore, callId: string): Promise<string | null> {
  const context = await b.loadContext(callId);
  const customerId = await b.customerForCall(callId);
  const saved = customerId ? await b.loadContext("preferences:" + customerId) : {};
  if (context.quick_entry === "translation") {
    const intro = saved.intro_translation_seen ? "" : "דיבורא, תרגום. לתפריט אמרו: תפריט. ";
    return `אמרו רק: ${intro}אמרו את המשפט לתרגום. המתינו לדיבור, ללא הסברים נוספים.`;
  }
  if (context.quick_entry === "school") {
    const intro = saved.intro_school_seen ? "" : "פתחו בקצרה: דיבורא, בית הספר לאנגלית. לתפריט אמרו: תפריט. ";
    return intro + "התחילו מיד בלמידה בדיבורא, ללא תפריט, הרשמה או נאום פתיחה. אם קיים שיעור משויך, המשיכו ממנו בשאלה קצרה אחת. אחרת פתחו בעברית בתרגול אנגלית קל ובשאלה אחת. התאימו את הרמה להיסטוריה.";
  }
  return null;
}

export async function markQuickIntro(b: BusinessStore, callId: string, customerId: string) {
  const context = await b.loadContext(callId);
  if (["school", "translation"].includes(context.quick_entry) && !customerId.startsWith("anonymous-")) {
    await b.savePreference(customerId, { ["intro_" + context.quick_entry + "_seen"]: true });
  }
}

export async function narrationForSlot(b: BusinessStore, slot: string, content: string) {
  const bindings = await b.loadContext("audio-bindings");
  const id = bindings[slot];
  if (!id) return null;
  const record = await b.record("narrations", id);
  const audio = await b.getAudio(id);
  if (!record || record.status !== "approved" || record.text !== content || !audio || audio.text_hash !== await sha256Hex(content)) return null;
  return { id, hash: await sha256Hex(audio.wav), wav: audio.wav };
}

export async function handleCallback(request: Request, env: Env, s: Settings, route: string): Promise<IVRResponse> {
  const url = new URL(request.url);
  if (!s.projectEnabled || !secureEqual(url.searchParams.get("key"), s.callbackSecret)) throw new HttpError(401, "Unauthorized");
  const clock = Date.now();
  const p = Object.fromEntries(url.searchParams);
  if (request.method === "POST") {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16384) throw new HttpError(413, "Callback too large");
    const form = [...new URLSearchParams(raw)];
    if (form.length > 100) throw new HttpError(400, "Invalid callback");
    Object.assign(p, Object.fromEntries(form));
  }
  const callId = p.PBXcallId ?? "";
  if (!callId || callId.length > 200 || p.PBXnum !== s.systemPhone) throw new HttpError(400, "Unexpected system or call");
  const path = "/" + (p.PBXextensionPath ?? "").replace(/^\/+|\/+$/g, "");
  if (path !== s.projectPath && !path.startsWith(s.projectPath + "/")) throw new HttpError(403, "Outside project extension");
  const b = new BusinessStore(env.DB);
  const progress = new ProgressStore(env.DB);
  const customerId = await b.identifyCall(p.PBXphone ?? "private", callId, "ivr");
  const values: Record<string, unknown> = {};
  const languages: Record<string, string> = { "1": "English", "2": "Hebrew", "3": "Yiddish", "4": "Arabic", "5": "Russian", "6": "French", "7": "" };
  if (route === "languages" && Object.hasOwn(languages, p.isaacLanguage)) values.language = languages[p.isaacLanguage];
  const modeKey = ({ basic: "isaacBasicMode", advanced: "isaacAdvancedMode", mode: "isaacMode" } as Record<string, string>)[route];
  if (modeKey && ["1", "2"].includes(p[modeKey])) values.mode = p[modeKey] === "1" ? "course" : "free";
  if (Object.keys(values).length) {
    await b.saveContext(callId, values);
    await b.savePreference(customerId, values);
  }
  const copy = await getCopy(b);
  let result: IVRResponse;
  if (route === "sales") {
    const context = await b.loadContext("payments:" + callId);
    let ids: string[] = context.package_ids;
    if (!ids) {
      ids = (await b.list("packages")).filter((pkg) => pkg.active && pkg.price_ils > 0 && (pkg.phone_enabled ?? true)).slice(0, 8).map((pkg) => pkg.id);
      await b.saveContext("payments:" + callId, { package_ids: ids });
    }
    result = await paymentResponse(new PaymentStore(b), env, s.projectPath, p, customerId, ids);
  } else if (p.PBXcallStatus === "HANGUP") result = { type: "hangup" };
  else if ((route === "main" && p.isaacMain === "1") || (route === "school" && [undefined, "1"].includes(p.isaacTeacher)) || (route === "mode" && ["1", "2"].includes(p.isaacMode))) {
    result = await startSchool(b, progress, s, callId, customerId);
  } else if ((route === "main" && p.isaacMain === "2") || (route === "translator" && [undefined, "1", "START"].includes(p.isaacTranslation)) || route === "start-translation" || (route === "languages" && Object.hasOwn(languages, p.isaacLanguage))) {
    result = await startTranslation(b, progress, s, callId, customerId);
  } else if (route === "teachers" || route === "bots") result = await chooseTeacher(b, progress, s, p, callId, customerId, route === "bots");
  else result = ivrResponse(route, p, copy, s.projectPath);
  if (route === "options" && result.type === "simpleMenu") {
    const others = (await progress.listBots()).some((bot) => bot.enabled && bot.phone_enabled && !["teacher", "translator"].includes(bot.role));
    result.enabledKeys = "0,1,2,3,4,5" + (others ? ",6" : "");
    if (others) result.files[0].text += " לבוטים נוספים הקישו 6.";
  }
  let slot = ({ main: "welcome", options: "options", school: "school", translator: "translator", languages: "languages", sales: "sales", quota: "quota", mode: "school_mode", service: "service" } as Record<string, string>)[route];
  if (slot && result.files?.length) {
    if (route === "service" && result.name === "isaacThanks") slot = "thanks";
    const audio = await narrationForSlot(b, slot, result.files[0].text ?? "");
    if (audio && s.publicBaseUrl) result.files = [{ fileLink: s.publicBaseUrl.replace(/\/$/, "") + `/v1/technoline/narrations/${audio.id}/${audio.hash}.wav` }];
  }
  const inputs = Object.fromEntries(Object.entries(p).filter(([key]) => key.startsWith("isaac") || key === "FILEID_isaacMessage").map(([key, value]) => [key, value.slice(0, 200)]));
  await b.save("ivr-events", { call_id: callId, customer_id: customerId, route, input: inputs, output: result, latency_ms: Date.now() - clock, at: nowIso(), request_method: request.method }, randomHex(16));
  return result;
}
