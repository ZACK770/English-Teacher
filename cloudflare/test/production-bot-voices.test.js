import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setProductionBotVoices } from "../../scripts/set-production-bot-voices.mjs";

const targets = { adult: 1, "isaac-advanced": 1, "isaac-basic": 2, "isaac-translator": 1, sales: 1, student: 2, "voice-navigator": 3, "waze-770": 1 };
const time = "2026-11-22T12:00:00.000Z";
const original = '{"voice":"Aoede","custom_instructions":"Keep Aoede mentioned here."}';
const updated = '{"voice":"Puck","custom_instructions":"Keep Aoede mentioned here."}';
let db, query, log;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  for (const [id, version] of Object.entries({ ...targets, unrelated: 1 })) {
    db.prepare("INSERT INTO bots(id,label,role,active_version,created_at,updated_at) VALUES (?,?,'teacher',?,?,?)").run(id, id, version, time, time);
    db.prepare("INSERT INTO tutor_profile_settings VALUES (?,?,?)").run(id, original, time);
    db.prepare("INSERT INTO bot_versions(bot_id,version,settings_json,created_at) VALUES (?,?,?,?)").run(id, version, original, time);
  }
  db.prepare("INSERT INTO console_records VALUES ('learner-teachers:example','teacher',?,?,?)").run(original, time, time);
  query = vi.fn(async (sql, params) => db.prepare(sql).all(...params));
  log = vi.fn();
});

afterEach(() => db.close());

it("updates only the eight targeted bot defaults, preserving settings and version history", async () => {
  await setProductionBotVoices(query, log);
  expect(query).toHaveBeenCalledTimes(1 + 3 * 8);
  for (const [id, prior] of Object.entries(targets)) {
    const active = db.prepare("SELECT active_version FROM bots WHERE id=?").get(id).active_version;
    expect(active).toBe(prior + 1);
    expect(db.prepare("SELECT settings_json FROM tutor_profile_settings WHERE profile_id=?").get(id).settings_json).toBe(updated);
    expect(db.prepare("SELECT settings_json FROM bot_versions WHERE bot_id=? ORDER BY version").all(id).map(r => r.settings_json)).toEqual([original, updated]);
  }
  expect(db.prepare("SELECT settings_json FROM tutor_profile_settings WHERE profile_id='unrelated'").get().settings_json).toBe(original);
  expect(db.prepare("SELECT body FROM console_records").get().body).toBe(original);
  await setProductionBotVoices(query, log);
  expect(log).toHaveBeenLastCalledWith("Updated 0 of 8 bots.");
  expect(query).toHaveBeenCalledTimes(2 + 3 * 8);
});

it("stops before writes when a targeted bot no longer matches", async () => {
  db.prepare("UPDATE tutor_profile_settings SET settings_json=json_set(settings_json,'$.voice','Kore') WHERE profile_id='waze-770'").run();
  await expect(setProductionBotVoices(query, log)).rejects.toThrow("Unexpected voice or version for waze-770");
  expect(query).toHaveBeenCalledTimes(1);
});

it("can resume after a staged version and after updated settings", async () => {
  db.prepare("INSERT INTO bot_versions(bot_id,version,settings_json,created_at) VALUES ('adult',2,?,?),('student',3,?,?)").run(updated, time, updated, time);
  db.prepare("UPDATE tutor_profile_settings SET settings_json=? WHERE profile_id='student'").run(updated);
  await setProductionBotVoices(query, log);
  expect(query).toHaveBeenCalledTimes(1 + 3 * 8 - 3);
  expect(log).toHaveBeenLastCalledWith("Updated 8 of 8 bots.");
  expect(db.prepare("SELECT active_version FROM bots WHERE id='student'").get().active_version).toBe(3);
});
