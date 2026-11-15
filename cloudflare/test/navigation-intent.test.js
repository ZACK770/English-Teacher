import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyIntent, echoOf, filler, ruleIntent } from "../src/navigation-intent";
import { estimates, providerCost } from "../src/navigation-cost";
import { passesThrough, trafficText } from "../src/navigation-call";
import { RouteGuidance } from "../src/navigation-route";
import { transcribeSetup } from "../src/navigation-session";

afterEach(() => vi.unstubAllGlobals());

describe("text mode rules", () => {
  it("answers frequent requests without a model", () => {
    expect(ruleIntent("כן.", true)).toEqual({ intent: "confirm" });
    expect(ruleIntent("לא", true)).toEqual({ intent: "decline" });
    expect(ruleIntent("כן", false)).toBeNull();
    expect(ruleIntent("האם יש שם סיי תנועה?", false)).toEqual({ intent: "traffic" });
    expect(ruleIntent("כמה זמן ייקח לי?", false)).toEqual({ intent: "eta" });
    expect(ruleIntent("אני רוצה שתתארי באופן כללי את הנסיעה", false)).toEqual({ intent: "overview" });
    expect(ruleIntent("השאלה שלי זה האם אנחנו יכולים לנסוע דרך כביש 443 או שהמסלול הוא דרך כביש 1", false)).toBeNull();
    expect(ruleIntent("אפשר דרך כביש 4 4 3?", false)).toEqual({ intent: "route_via", via: "כביש 443" });
    expect(ruleIntent("בטל את הניווט", false)).toEqual({ intent: "cancel" });
  });
  it("leaves destinations to the model, even with road words", () => {
    expect(ruleIntent("אני רוצה לנסוע לרחוב ירמיהו 45 בירושלים", false)).toBeNull();
    expect(ruleIntent("קח אותי לדרך בגין 5 תל אביב", false)).toBeNull();
  });
  it("ignores fillers and the navigator's own echo", () => {
    for (const t of ["אממ", "תודה רבה.", "אני שומע", "היי"]) expect(filler(t)).toBe(true);
    expect(filler("מה עכשיו")).toBe(false);
    expect(echoOf("סע דרומה באהרונוביץ' לכיוון הרב ריינס", "סע דרומה באהרונוביץ' לכיוון הרב ריינס. בעוד 30 מטרים")).toBe(true);
    expect(echoOf("אני רוצה לנסוע לירושלים", "סע דרומה באהרונוביץ'")).toBe(false);
  });
  it("asks the small model with a short fixed context and records its usage", async () => {
    const fetch = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"intent":"destination","destination":"ירמיהו 45, ירושלים","ask_eta":true}' }] } }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20, promptTokensDetails: [{ modality: "TEXT", tokenCount: 300 }] } }));
    vi.stubGlobal("fetch", fetch);
    const { request, usage } = await classifyIntent({ geminiRestUrl: "https://g", geminiKey: "k" }, { said: "אני רוצה לנסוע לירמיהו 45 בירושלים, כמה זמן זה?", navigator: "לאן תרצה להגיע?", pending: null, active: null, previous: "" });
    expect(request).toEqual({ intent: "destination", destination: "ירמיהו 45, ירושלים", ask_eta: true });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(String(fetch.mock.calls[0][0])).toContain("models/gemini-3.5-flash-lite:generateContent");
    expect(body.contents[0].parts[0].text).toContain("Driver now said: אני רוצה לנסוע");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    const cost = providerCost([{ channel: "intent", model: "gemini-3.5-flash-lite", usage }], ["main"], { usd_ils: 3 });
    const intent = cost.channels.find((c) => c.channel === "intent");
    expect(intent.missing).toEqual([]);
    expect(intent.usd).toBeCloseTo((300 * 0.3 + 20 * 2.5) / 1e6, 10);
  });
  it("maps an unexpected model answer to unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"intent":"sing"}' }] } }] })));
    expect((await classifyIntent({ geminiRestUrl: "https://g", geminiKey: "k" }, { said: "תשיר", navigator: "", pending: null, active: null, previous: "" })).request).toEqual({ intent: "unknown" });
  });
});

describe("text mode setup and cost", () => {
  it("uses Live Transcribe in Hebrew with smart mode and vocabulary", () => {
    const { setup } = transcribeSetup(["הרב פוברסקי"]);
    expect(setup.model).toBe("models/gemini-3.5-transcribe-live");
    expect(setup.generationConfig.responseModalities).toEqual(["TEXT"]);
    expect(setup.inputAudioTranscription).toMatchObject({ languageCodes: ["he-IL"], mode: "SMART" });
    expect(setup.inputAudioTranscription.customVocabulary).toContain("כביש 443");
    expect(setup.inputAudioTranscription.customVocabulary).toContain("הרב פוברסקי");
    expect(setup.tools).toBeUndefined();
  });
  it("estimates unreported transcription from streamed audio", () => {
    const e = estimates({ transcribe_audio_ms: 120000 }, [], { usd_ils: 3 });
    expect(e.estimated_unreported_usd).toBeCloseTo(0.018, 9);
    expect(e.estimated_unreported_ils).toBeCloseTo(0.054, 9);
    expect(estimates({ transcribe_audio_ms: 120000 }, [{ channel: "main", model: "models/gemini-3.5-transcribe-live", usage: {} }], null)).toEqual({});
  });
});

describe("route answers", () => {
  const route = { points: [[32, 34], [32, 34.01]], cumulative: [0, 943], seconds: 1500, staticSeconds: 1080, description: "כביש 1",
    steps: [{ along: 0, instruction: "סע מזרחה", maneuver: "DEPART" }, { along: 400, instruction: "פנה שמאלה אל כביש 4", maneuver: "TURN_LEFT" }] };
  it("matches road numbers as whole numbers", () => {
    expect(passesThrough(route, "כביש 1")).toBe(true);
    expect(passesThrough(route, "כביש 4")).toBe(true);
    expect(passesThrough(route, "כביש 443")).toBe(false);
  });
  it("reports traffic delay against the no-traffic duration", () => {
    expect(trafficText(route)).toBe("יש עומסים בדרך, תוספת של כ-7 דקות. זמן משוער כ-25 דקות.");
    expect(trafficText({ ...route, staticSeconds: 1450 })).toBe("אין עומסים מיוחדים. זמן משוער כ-25 דקות.");
    expect(trafficText({ ...route, staticSeconds: undefined })).toBe("זמן הנסיעה עם התנועה כרגע: כ-25 דקות.");
  });
  it("summarises the route instead of repeating the next instruction", () => {
    expect(new RouteGuidance(route).summary().say).toBe("המסלול דרך כביש 1, כ-943 מטרים, כ-25 דקות. הפניות הקרובות: פנה שמאלה אל כביש 4.");
  });
});

import { adminCommand, isAdminPhone } from "../src/navigation-admin";
import { hebrewInstruction } from "../src/navigation-route";

describe("approved follow-ups", () => {
  it("treats check-again as status and repeat as repeat", () => {
    expect(ruleIntent("אוקיי, תוכלי לבדוק שוב?", false)).toEqual({ intent: "status" });
    expect(ruleIntent("תבדוק שוב", false)).toEqual({ intent: "status" });
    expect(ruleIntent("תחזור על זה", false)).toEqual({ intent: "repeat" });
    expect(ruleIntent("לא שמעתי", false)).toEqual({ intent: "repeat" });
  });
  it("filters more acknowledgements and accepts casual yes", () => {
    for (const t of ["הבנתי.", "ביי.", "אני מודה לך.", "בסדר"]) expect(filler(t)).toBe(true);
    expect(ruleIntent("סבבה", true)).toEqual({ intent: "confirm" });
  });
  it("makes merge instructions singular", () => {
    expect(hebrewInstruction("התמזגו אל כביש 4")).toBe("התמזג אל כביש 4");
  });
  it("parses spoken admin mode commands", () => {
    expect(adminCommand("קבע לי מצב טקסט")).toEqual({ kind: "set", scope: "self", mode: "text" });
    expect(adminCommand("תשנה לכולם את המצב לג'מיני מדבר")).toEqual({ kind: "set", scope: "all", mode: "gemini" });
    expect(adminCommand("קבע ברירת מחדל מצב מנוע")).toEqual({ kind: "set", scope: "all", mode: "engine" });
    expect(adminCommand("איזה מצב פעיל?")).toEqual({ kind: "query" });
    expect(adminCommand("באיזה מצב התנועה בכביש?")).toBeNull();
    expect(adminCommand("אני רוצה לנסוע לטקסטיל 5")).toBeNull();
  });
  it("allows only admin numbers in any format", () => {
    expect(isAdminPhone("+972527180504", ["0527180504"])).toBe(true);
    expect(isAdminPhone("0527180504", ["0527180504"])).toBe(true);
    expect(isAdminPhone("0500000001", ["0527180504"])).toBe(false);
    expect(isAdminPhone("", ["0527180504"])).toBe(false);
  });
});
