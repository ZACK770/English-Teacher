import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";

let sql: DatabaseSync;
const backfill = readFileSync(new FileURL("../migrations/0030_practice_history.sql", import.meta.url), "utf8");
beforeEach(() => {
  sql = new DatabaseSync(":memory:");
  for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql") && n < "0030").sort()) {
    sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
  }
  sql.exec("INSERT INTO bots(id,label,role,created_at,updated_at) VALUES ('history-teacher','Teacher','teacher','2026','2026'),('history-translator','Translator','translator','2026','2026')");
});
afterEach(() => sql.close());

function session(id: string, at: string, seconds: number, channel = "phone", customer = "learner", bot = "history-teacher") {
  sql.prepare("INSERT INTO call_customers(call_id,customer_id,bot_id,channel,created_at) VALUES (?,?,?,?,?)").run(id, customer, bot, channel, at);
  sql.prepare("INSERT INTO sessions(student_id,call_id,started_at,ended_at,duration_seconds,learner_turns,tutor_turns,observations_json) VALUES (?,?,?,?,?,1,1,'[]')").run(customer, id, at, at, seconds);
}

describe("practice history migration", () => {
  it("backfills shared phone/web days without double counting on reruns or later calls", () => {
    session("phone", "2026-06-13T21:30:00+00:00", 119);
    session("web", "2026-06-14T10:00:00Z", 1, "web");
    session("translator", "2026-06-14T10:00:00Z", 999, "phone", "learner", "history-translator");
    session("anonymous", "2026-06-14T10:00:00Z", 999, "phone", "anonymous-123");
    sql.exec(backfill);
    const expected = [{ customer_id: "learner", day: "2026-06-14", seconds: 120, calls: 2, first_at: "2026-06-13T21:30:00.000Z", last_at: "2026-06-14T10:00:00.000Z" }];
    expect(sql.prepare("SELECT * FROM practice_days").all()).toEqual(expected);
    sql.exec(backfill);
    expect(sql.prepare("SELECT * FROM practice_days").all()).toEqual(expected);
    session("after-release", "2026-06-14T12:00:00Z", 180);
    sql.exec("UPDATE practice_days SET seconds=seconds+180,calls=calls+1");
    sql.exec(backfill);
    expect(sql.prepare("SELECT seconds,calls FROM practice_days").get()).toEqual({ seconds: 300, calls: 3 });
  });

  it("matches Asia/Jerusalem through winter/summer midnight and both DST transitions", () => {
    const instants = [
      "2025-01-01T21:59:59Z", "2025-01-01T22:00:00Z",
      "2026-03-26T21:59:59Z", "2026-03-26T22:00:00Z",
      "2026-03-26T23:59:59Z", "2026-03-27T00:00:00Z",
      "2026-03-27T20:59:59Z", "2026-03-27T21:00:00Z",
      "2026-06-14T20:59:59Z", "2026-06-14T21:00:00Z",
      "2026-10-24T22:59:59Z", "2026-10-24T23:00:00Z",
      "2026-10-25T21:59:59Z", "2026-10-25T22:00:00Z",
      "2026-12-14T21:59:59Z", "2026-12-14T22:00:00Z",
    ];
    instants.forEach((at, i) => session("boundary-" + i, at, 120, "phone", "learner-" + i));
    sql.exec(backfill);
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });
    instants.forEach((at, i) => {
      expect(sql.prepare("SELECT day FROM practice_days WHERE customer_id=?").get("learner-" + i)).toEqual({ day: formatter.format(new Date(at)) });
    });
  });
});
