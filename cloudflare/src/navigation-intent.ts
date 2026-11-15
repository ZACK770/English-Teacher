import { postJson } from "./google";
import type { Settings } from "./env";
import { NavigationRequestSchema } from "./navigation-call";

export const INTENT_MODEL = "gemini-3.5-flash-lite";
export const TRANSCRIBE_MODEL = "models/gemini-3.5-transcribe-live";

const YES = new Set(["כן", "נכון", "בטח", "סע", "יאללה", "אישור", "מאשר", "בדיוק", "אוקיי", "בסדר", "סבבה", "אחלה", "מעולה", "יופי"]);
const NO = new Set(["לא", "ממש"]);
const FILLER = new Set(["אממ", "אמ", "אה", "אהה", "הממ", "היי", "הלו", "אוקיי", "טוב", "תודה", "רבה", "סבבה", "יופי", "הבנתי", "ביי", "בסדר", "מודה", "לך", "שלום", "מעולה", "אחלה", "שומע", "שומעת", "אני", "נו", "רגע"]);

const words = (text: string) => text.replace(/[^\u0590-\u05FF0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);

/** A bare yes/no answer. */
export function shortAnswer(text: string): "confirm" | "decline" | null {
  const w = words(text).filter((x) => !/\d/.test(x));
  if (!w.length || w.length > 4) return null;
  if (w.every((x) => YES.has(x))) return "confirm";
  if (w.includes("לא") && w.every((x) => NO.has(x) || x === "נכון")) return "decline";
  return null;
}

/** "לא, עד לא, אני רוצה": a "no" mixed with wanting/agreeing is unclear, not a refusal. */
export function mixedAnswer(text: string): boolean {
  const w = words(text);
  return w.includes("לא") && w.some((x) => YES.has(x) || ["רוצה", "רוצים", "מעוניין", "בטח"].includes(x));
}

/** Short acknowledgements and fillers ("אממ", "תודה רבה", "אני שומע") need no answer. */
export function filler(text: string): boolean {
  const w = words(text);
  return !w.length || (w.length <= 3 && w.every((x) => FILLER.has(x)));
}

/** The line can carry the navigator's own voice back; a transcript made mostly of its last sentence is echo. */
export function echoOf(text: string, spoken: string): boolean {
  const said = words(text), heard = new Set(words(spoken));
  return said.length >= 3 && said.filter((x) => heard.has(x)).length / said.length >= 0.7;
}

export type IntentRequest = { intent: string; destination?: string; ask_eta?: boolean; via?: string };

/** Frequent requests are recognised without any model. Returns null when the sentence needs the model. */
export function ruleIntent(text: string, awaiting: boolean): IntentRequest | null {
  const t = text.replace(/[״"'׳?!.,]/g, " ").replace(/\s+/g, " ").trim();
  const answer = awaiting ? shortAnswer(t) : null;
  if (answer) return { intent: answer };
  const going = /(לנסוע|להגיע|לסוע|ניסע|תיקח אותי|קח אותי|רוצה ל)/.test(t);
  if (/^(בטל|תבטל|לבטל|עצור|תעצור|הפסק)( את)?( הניווט| הנסיעה)?$/.test(t)) return { intent: "cancel" };
  const road = t.match(/כביש\s*(\d(?:[\d\s]{0,6}\d)?)/) ?? (!going ? t.match(/דרך\s+(\d{1,3}(?:\s\d){0,2})(?:\s|$)/) : null);
  if (road && !going) return { intent: "route_via", via: `כביש ${road[1].replace(/\s/g, "")}` };
  if (going) return null;
  if (/(עומס|פקק|תנועה)/.test(t)) return { intent: "traffic" };
  if (/(כמה זמן|מתי (אני )?(אגיע|נגיע|מגיע)|כמה (עוד )?נשאר|זמן (ה)?הגעה|כמה דקות)/.test(t)) return { intent: "eta" };
  if (/(פירוט|תאר|תתאר|תתארי|כל המסלול|את המסלול|סקירה|איך הולך המסלול|באיזו דרך)/.test(t)) return { intent: "overview" };
  if (/^(מה עכשיו|לאן (לפנות|עכשיו|פונים)|מה הלאה|מה ההוראה|איפה לפנות)$/.test(t) || /(תבדוק|תבדקי|בדוק|תבדוק את זה) (שוב|עוד פעם|מחדש)/.test(t)) return { intent: "status" };
  if (/(תחזור|תחזרי|חזור) על (זה|זאת|ההוראה|מה שאמרת)|תגיד שוב|תגידי שוב|לא שמעתי|מה אמרת|עוד פעם\s*$/.test(t)) return { intent: "repeat" };
  return null;
}

const INTENTS = [...NavigationRequestSchema.shape.intent.options, "repeat", "noise"];
const PROMPT = `Classify one Hebrew utterance of a driver to a phone navigation system. The transcript may contain recognition errors; infer the most likely meaning.
Intents: destination (driver names where to drive; put the place with its town in destination exactly as said, never invent), confirm / decline (answer to the navigator's last question), status (what now, where to turn, check again), repeat (say again what the navigator just said), eta (how long, when will I arrive), traffic (traffic, jams, delays), overview (describe the route / which way it goes), route_via (go via a specific road; put the road in via, e.g. "כביש 443"), report (made a mistake, missed a turn, lost), see (sees a sign or landmark), complete (arrived), cancel (stop the navigation), unknown (any other question or request to the navigator), noise (not addressed to the navigator, or a statement that asks nothing: chatter, thanks, "I am starting to drive", fragments).
ask_eta: true when a destination request also asks how long it takes.`;
const SCHEMA = { type: "OBJECT", properties: {
  intent: { type: "STRING", enum: INTENTS }, destination: { type: "STRING" }, via: { type: "STRING" }, ask_eta: { type: "BOOLEAN" },
}, required: ["intent"] };

export interface IntentContext { said: string; navigator: string; pending: string | null; active: string | null; previous: string }

/** One small text-model call with a fixed, short context: the price per request does not grow with the call. */
export async function classifyIntent(s: Settings, c: IntentContext): Promise<{ request: IntentRequest; usage: Record<string, unknown> }> {
  const lines = [
    `Navigator last said: ${c.navigator || "(nothing yet)"}`,
    c.pending ? `Navigator is waiting for yes/no to start driving to: ${c.pending}` : "",
    c.active ? `Active trip to: ${c.active}` : "No active trip.",
    c.previous ? `Driver's previous utterance: ${c.previous}` : "",
    `Driver now said: ${c.said}`,
  ].filter(Boolean).join("\n");
  const result = await postJson(`${s.geminiRestUrl}/models/${INTENT_MODEL}:generateContent?key=${encodeURIComponent(s.geminiKey)}`, {
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [{ role: "user", parts: [{ text: lines }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA, thinkingConfig: { thinkingLevel: "minimal" } },
  }, {}, 6000);
  const text = (result.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  const data = JSON.parse(text || "{}") as Record<string, unknown>;
  const request: IntentRequest = { intent: INTENTS.includes(String(data.intent)) ? String(data.intent) : "unknown" };
  if (typeof data.destination === "string" && data.destination.trim().length >= 3) request.destination = data.destination.trim().slice(0, 300);
  if (typeof data.via === "string" && data.via.trim()) request.via = data.via.trim().slice(0, 80);
  if (data.ask_eta === true) request.ask_eta = true;
  return { request, usage: (result.usageMetadata ?? {}) as Record<string, unknown> };
}
