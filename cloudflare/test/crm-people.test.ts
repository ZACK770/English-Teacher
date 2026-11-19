import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import { type Env } from "../src/env";
import { deriveStatus, INACTIVE_DAYS, SHORT_SESSION_SECONDS } from "../src/crm-people";
import worker from "../src/index";

let sql: DatabaseSync, env: Env;
beforeEach(() => {
  sql = new DatabaseSync(":memory:");
  for (const file of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new FileURL("../migrations/" + file, import.meta.url), "utf8"));
  const db = {
    prepare(query: string) {
      let args: any[] = [];
      const statement = {
        bind: (...values: any[]) => { args = values; return statement; },
        first: async () => sql.prepare(query).get(...args) || null,
        all: async () => ({ results: sql.prepare(query).all(...args), success: true }),
        run: async () => ({ meta: { changes: Number(sql.prepare(query).run(...args).changes) }, success: true }),
      };
      return statement;
    },
    async batch(statements: any[]) { return Promise.all(statements.map(s => s.all())); },
  };
  env = { DB: db, ADMIN_BEARER_SECRET: "crm-test-secret" } as unknown as Env;
});
afterEach(() => sql.close());
const now = new Date().toISOString();
function customer(id = "person1", phone = "0501234567") {
  sql.prepare("INSERT INTO customers(id,name,primary_phone,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, "שם מוקלד", phone, now, now);
  sql.prepare("INSERT INTO console_records VALUES ('customers',?,?,?,?)").run(id, JSON.stringify({ name: "יעל כהן", phone, email: "yael@example.test", source: "אתר" }), now, now);
}
function event(kind: string, body: any) { sql.prepare("INSERT INTO console_records VALUES (?,?,?,?,?)").run(kind, crypto.randomUUID(), JSON.stringify({ customer_id: "person1", at: now, ...body }), now, now); }
function session(id = "call1", transcript: string | null = JSON.stringify([{ role: "learner", text: "Hello" }])) {
  sql.prepare("INSERT INTO sessions(student_id,call_id,started_at,ended_at,duration_seconds,learner_turns,tutor_turns,observations_json,transcript_json,summary_he,estimated_cost_usd,cost_basis) VALUES (?,?,?,?,?,1,1,'[]',?,'תרגול היכרות',0.1,'gemini_usage_metadata')").run("person1", id, now, now, 120, transcript);
  sql.prepare("INSERT INTO call_customers VALUES (?,?,?,'phone',?)").run(id, "person1", "teacher1", now);
}
const request = (path: string, auth = true, method = "GET") => worker.fetch(new Request("https://speakcall.app/v1/admin/crm/" + path, { method, headers: auth ? { Authorization: "Bearer crm-test-secret" } : {} }), env);

describe("CRM status priority", () => {
  const base = { paid: false, callback: false, offered: false, activity: false, longest: 120, last: now, sessions: 0 };
  it("handles new, trial, short and inactive sessions and priority", () => {
    expect(deriveStatus(base)).toBe("new");
    expect(deriveStatus({ ...base, sessions: 1, activity: true })).toBe("trial");
    expect(deriveStatus({ ...base, sessions: 1, activity: true, longest: SHORT_SESSION_SECONDS })).toBe("dropped");
    expect(deriveStatus({ ...base, sessions: 1, activity: true, last: new Date(Date.now() - (INACTIVE_DAYS + 1) * 86400000).toISOString() })).toBe("dropped");
    expect(deriveStatus({ ...base, offered: true, activity: true })).toBe("offer_no_buy");
    expect(deriveStatus({ ...base, offered: true, callback: true })).toBe("callback_pending");
    expect(deriveStatus({ ...base, paid: true, callback: true, offered: true })).toBe("paying");
  });
});
describe("CRM read-only endpoints", () => {
  it("requires admin and handles empty/not found/invalid filters/methods", async () => {
    expect((await request("people", false)).status).toBe(401);
    expect(await (await request("people")).json()).toMatchObject({ items: [], total: 0, cursor: null, counts: { paying: 0 } });
    for (const path of ["people/missing", "calls/missing/transcript"]) expect((await request(path)).status).toBe(404);
    for (const query of ["limit=0", "limit=201", "limit=no", "status=invalid", "cursor=missing"]) expect((await request("people?" + query)).status).toBe(422);
    expect((await request("people", true, "POST")).status).toBe(405);
  });
  it("removes external font links only for CRM HTML", async () => {
    env.ASSETS = { fetch: async () => new Response('<html><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><div>שלום</div></html>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher;
    const crm = await worker.fetch(new Request('https://speakcall.app/dashboard/crm'), env);
    expect(await crm.text()).not.toContain('fonts.google');
    const old = await worker.fetch(new Request('https://speakcall.app/dashboard'), env);
    expect(await old.text()).toContain('fonts.googleapis.com');
  });
  it("matches scheduled callbacks by normalized phone and includes typed-only/JSON-only people", async () => {
    customer();
    sql.prepare("INSERT INTO customers(id,name,created_at,updated_at) VALUES ('typed','לקוח מטבלה',?,?)").run(now, now);
    sql.prepare("INSERT INTO console_records VALUES ('customers','json',?,?,?)").run(JSON.stringify({ name: "לקוח ממסמך", phone: "0502222222" }), now, now);
    sql.prepare("INSERT INTO callback_requests(id,phone,name,for_whom,goal,timing,source,consent_at,status,created_at,updated_at) VALUES ('cb','+972501234567','בדיקה','self','תרגול','now','אתר',?,'queued',?,?)").run(now, now, now);
    const result = await (await request('people')).json() as any;
    expect(result.total).toBe(3);
    expect(result.items.find((p: any) => p.id === 'person1').status).toBe('callback_pending');
    const card = await (await request('people/person1')).json() as any;
    expect(card.journey).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'callback', label: 'בקשה לשיחה חוזרת' })]));
  });
  it("merges typed+JSON once, aggregates costs, supports filters/counts and stable pagination", async () => {
    customer(); customer("person2", "0507654321"); session();
    event("ad-entries", { call_id: "call1", campaign: "pirsumofon-news" });
    sql.prepare("INSERT INTO console_settings VALUES ('economics',?)").run(JSON.stringify({ usd_ils: 4, forecast_cost_per_minute: 0.2 }));
    const result = await (await request("people?limit=1")).json() as any;
    expect(result).toMatchObject({ total: 2, cursor: "person1", counts: { trial: 1, new: 1 } });
    expect(result.items[0]).toMatchObject({ name: "יעל כהן", phone: "0501234567", calls_count: 1, minutes_used: 2, total_cost_ils: 0.8, ad_source: "pirsumofon-news", channels: ["phone", "web"] });
    expect((await (await request("people?limit=1&cursor=person1")).json() as any).items[0].id).toBe("person2");
    expect((await (await request("people?q=yael&source=pirsumofon-news&status=trial")).json() as any).items).toHaveLength(1);
    expect((await (await request("people?q=missing")).json() as any).items).toEqual([]);
  });
  it("derives callback/offer/payer from persisted records and preserves precedence", async () => {
    customer(); event("ivr-events", { route: "sales" });
    expect((await (await request("people")).json() as any).items[0].status).toBe("offer_no_buy");
    event("sales-followups", { type: "lesson", status: "pending" });
    expect((await (await request("people")).json() as any).items[0].status).toBe("callback_pending");
    sql.prepare("INSERT INTO sales_receipts VALUES ('r1','person1','p1','school','test',59,0.18,100,?,?,NULL,NULL)").run(now, now);
    expect((await (await request("people")).json() as any).items[0]).toMatchObject({ status: "paying", revenue_ils: 59 });
  });
  it.each(["queued", "dialing", "done", "dialed", "failed"])("uses the matching callback's %s state instead of a stale lesson followup", async (status) => {
    customer();
    event("sales-followups", { type: "lesson", status: "pending", callback_id: "lesson-cb" });
    sql.prepare("INSERT INTO callback_requests(id,phone,name,for_whom,goal,timing,source,consent_at,status,created_at,updated_at) VALUES ('lesson-cb','+972501234567','בדיקה','self','תרגול','now','אתר',?,?,?,?)").run(now, status, now, now);
    const expected = ["queued", "dialing"].includes(status) ? "callback_pending" : "offer_no_buy";
    expect((await (await request("people")).json() as any).items[0].status).toBe(expected);
    expect((await (await request("people/person1")).json() as any).status).toBe(expected);
  });
  it("returns chronological journey/calls, lazy transcript, null recording and empty transcript", async () => {
    customer(); session(); session("empty", null);
    event("ivr-events", { call_id: "call1", route: "main", input: { isaacMain: "2" }, output: { goTo: "/99/2" } });
    const result = await (await request("people/person1")).json() as any;
    expect(result.calls).toHaveLength(2);
    expect(result.calls.find((c: any) => c.call_id === "call1")).toMatchObject({ has_transcript: true, recording: null, ai_cost_usd: 0.1 });
    expect(result.calls[0]).not.toHaveProperty("transcript_json");
    expect(result.journey).toEqual(expect.arrayContaining([expect.objectContaining({ label: "תפריט ראשי", input: { isaacMain: "2" }, destination: "/99/2", call_id: "call1" })]));
    expect(await (await request("calls/call1/transcript")).json()).toMatchObject({ turns: [{ role: "learner", text: "Hello" }], recording: null });
    expect(await (await request("calls/empty/transcript")).json()).toMatchObject({ turns: [] });
  });
});
